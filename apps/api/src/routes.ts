import { Router } from "express";
import type express from "express";
import {
  DemoCommandSchema,
  AlertStatusSchema,
  SeveritySchema,
  type DemoCommand,
} from "@sentinel/shared";
import { z } from "zod";
import { hub } from "./hub.js";
import { generateAdvisory } from "./ai/advisory.js";
import { config } from "./config.js";
import {
  getLastLoadTestResult,
  runLoadTest,
} from "./perf/loadRunner.js";

export const router = Router();

router.get("/health", (_req, res) => {
  const snap = hub.getSnapshot();
  res.json({
    status: "ok",
    service: "sentinel-api",
    mode: snap.mode,
    uptime_s: Math.round(process.uptime()),
  });
});

router.get("/health/stream", (_req, res) => {
  const health = hub.getSnapshot().health;
  res.json(health);
});

router.get("/health/metrics", (_req, res) => {
  const snap = hub.getSnapshot();
  res.json({
    events_per_minute: snap.kpi.events_per_minute,
    processing_rate: snap.health.processing_rate,
    active_alerts: snap.kpi.active_alerts,
    risk_score: snap.kpi.risk_score,
    freshness: snap.health.freshness,
    thresholds: config.thresholds,
    freshness_sla_seconds: config.freshnessSlaSeconds,
  });
});

router.get("/api/snapshot", (_req, res) => {
  res.json(hub.getSnapshot());
});

router.get("/api/alerts", (req, res) => {
  const severity = req.query.severity
    ? SeveritySchema.parse(String(req.query.severity))
    : undefined;
  const region = req.query.region
    ? String(req.query.region)
    : undefined;
  const metric = req.query.metric
    ? String(req.query.metric)
    : undefined;
  const status = req.query.status
    ? AlertStatusSchema.parse(String(req.query.status))
    : undefined;
  res.json(hub.alerts.getAlerts({ severity, region, metric, status }));
});

router.post("/api/alerts/:id/acknowledge", (req, res) => {
  const actor =
    typeof req.body?.actor === "string" && req.body.actor.trim()
      ? req.body.actor.trim()
      : "operator";
  const alert = hub.alerts.acknowledge(req.params.id, actor);
  if (!alert)
    return res
      .status(404)
      .json({ error: "Alert not found or not in ACTIVE status" });
  return res.json(alert);
});

router.post("/api/alerts/:id/assign", (req, res) => {
  const body = z
    .object({
      assigned_to: z.string().min(1).max(80),
      actor: z.string().min(1).max(80).optional(),
    })
    .safeParse(req.body ?? {});
  if (!body.success) {
    return res.status(400).json({ error: body.error.flatten() });
  }
  const alert = hub.alerts.assign(
    req.params.id,
    body.data.assigned_to,
    body.data.actor ?? "operator"
  );
  if (!alert)
    return res.status(404).json({ error: "Alert not found or already resolved" });
  return res.json(alert);
});

router.post("/api/alerts/:id/unassign", (req, res) => {
  const actor =
    typeof req.body?.actor === "string" && req.body.actor.trim()
      ? req.body.actor.trim()
      : "operator";
  const alert = hub.alerts.unassign(req.params.id, actor);
  if (!alert)
    return res
      .status(404)
      .json({ error: "Alert not found, unresolved assignment, or resolved" });
  return res.json(alert);
});

router.post("/api/alerts/:id/escalate", (req, res) => {
  const body = z
    .object({
      reason: z.string().max(500).optional(),
      actor: z.string().min(1).max(80).optional(),
    })
    .safeParse(req.body ?? {});
  if (!body.success) {
    return res.status(400).json({ error: body.error.flatten() });
  }
  const alert = hub.alerts.escalate(
    req.params.id,
    body.data.reason ?? "Operator escalation",
    body.data.actor ?? "operator"
  );
  if (!alert)
    return res.status(409).json({
      error:
        "Invalid transition — escalate requires ACTIVE or ACKNOWLEDGED status",
    });
  return res.json(alert);
});

router.post("/api/alerts/:id/resolve", (req, res) => {
  const actor =
    typeof req.body?.actor === "string" && req.body.actor.trim()
      ? req.body.actor.trim()
      : "operator";
  const alert = hub.alerts.resolve(req.params.id, actor);
  if (!alert) return res.status(404).json({ error: "Alert not found" });
  return res.json(alert);
});

router.get("/api/alerts/:id", (req, res) => {
  const alert = hub.alerts.getAlert(req.params.id);
  if (!alert) return res.status(404).json({ error: "Alert not found" });
  return res.json(alert);
});

router.get("/api/audit", (req, res) => {
  const limit = Math.min(500, Number(req.query.limit) || 100);
  res.json(hub.alerts.getAudit(limit));
});

router.get("/api/incidents", (_req, res) => {
  res.json(hub.alerts.getIncidents());
});

router.get("/api/incidents/:id", (req, res) => {
  const incident = hub.alerts.getIncident(req.params.id);
  if (!incident) return res.status(404).json({ error: "Incident not found" });
  return res.json(incident);
});

router.get("/api/regions", (_req, res) => {
  res.json(hub.getSnapshot().regions);
});

router.get("/api/advisory", (_req, res) => {
  const snap = hub.getSnapshot();
  const incident = snap.incidents.find((i) => i.status === "ACTIVE") ?? null;
  res.json(
    generateAdvisory(
      incident,
      snap.alerts,
      hub.processor.getPrimarySnapshot()
    )
  );
});

router.post("/api/demo", (req, res) => {
  const body = z.object({ command: DemoCommandSchema }).safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: "Invalid demo command", details: body.error.flatten() });
  }
  hub.demo(body.data.command);
  return res.json({ ok: true, command: body.data.command, mode: hub.simulator.getMode() });
});

/** Dedicated simulation control API (PS34 demo / ops) */
function simulationHandler(command: DemoCommand) {
  return (_req: express.Request, res: express.Response) => {
    hub.demo(command);
    return res.json({
      ok: true,
      command,
      simulation: hub.getSimulationState(),
    });
  };
}

router.post("/simulation/normal", simulationHandler("START_NORMAL"));
router.post("/simulation/high-load", simulationHandler("HIGH_LOAD"));
router.post("/simulation/anomaly", simulationHandler("SIMULATE_ANOMALY"));
router.post("/simulation/incident", simulationHandler("SIMULATE_INCIDENT"));
router.post("/simulation/failure", simulationHandler("SIMULATE_PIPELINE_FAILURE"));
router.post("/simulation/recover", simulationHandler("RECOVER_PIPELINE"));
router.get("/simulation/status", (_req, res) => {
  res.json(hub.getSimulationState());
});

router.get("/api/config/public", (_req, res) => {
  res.json({
    freshness_sla_seconds: config.freshnessSlaSeconds,
    high_risk_threshold: config.highRiskThreshold,
    critical_risk_threshold: config.criticalRiskThreshold,
    thresholds: config.thresholds,
    primary_metric: config.primaryMetric,
  });
});

router.get("/api/perf", (_req, res) => {
  const last = getLastLoadTestResult();
  if (!last) return res.status(404).json({ error: "No load test has been run yet" });
  return res.json(last);
});

router.post("/api/perf/run", async (req, res) => {
  const schema = z.object({
    target_eps: z.number().min(100).max(20_000).default(1000),
    duration_seconds: z.number().min(1).max(30).default(5),
  });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const result = await runLoadTest(
    parsed.data.target_eps,
    parsed.data.duration_seconds
  );
  return res.json(result);
});
