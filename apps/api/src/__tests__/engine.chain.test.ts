import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import { WebSocket } from "ws";
import express from "express";
import { StreamSimulator } from "../stream/simulator.js";
import { ProcessingEngine } from "../processing/engine.js";
import { AnomalyDetector } from "../anomaly/detector.js";
import { evaluateThreshold } from "../anomaly/threshold.js";
import { computeRiskScore } from "../anomaly/risk.js";
import { AlertEngine } from "../alerts/engine.js";
import { FreshnessMonitor } from "../health/freshness.js";
import { SentinelHub } from "../hub.js";
import { attachWebSocket } from "../stream/ws.js";
import { config } from "../config.js";
import type { StreamEvent } from "@sentinel/shared";
import { StreamEventSchema } from "@sentinel/shared";

function evt(partial: Partial<StreamEvent> = {}): StreamEvent {
  const now = new Date().toISOString();
  return {
    event_id: "e1",
    timestamp: now,
    server_timestamp: now,
    region: "north",
    service: "payments",
    metric: "failure_rate",
    value: 1.2,
    baseline_value: 1.2,
    status: "ok",
    source: "test",
    ...partial,
  };
}

describe("simulator", () => {
  it("generates normal events near baseline", async () => {
    const sim = new StreamSimulator({ speed: 3 });
    const values: number[] = [];
    sim.on("event", (e: StreamEvent) => {
      if (e.metric === "failure_rate") values.push(e.value);
    });
    sim.startNormal();
    await wait(300);
    sim.stop();
    expect(values.length).toBeGreaterThan(0);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    expect(avg).toBeGreaterThan(0.5);
    expect(avg).toBeLessThan(3);
    expect(sim.getState().mode).toBe("NORMAL");
  });

  it("anomaly escalates values over time", async () => {
    const sim = new StreamSimulator({ speed: 5 });
    const values: number[] = [];
    sim.on("event", (e: StreamEvent) => {
      if (e.metric === "failure_rate") values.push(e.value);
    });
    sim.simulateAnomaly();
    await wait(800);
    sim.stop();
    expect(values.length).toBeGreaterThan(5);
    const early = avg(values.slice(0, 3));
    const late = avg(values.slice(-3));
    expect(late).toBeGreaterThan(early);
  });

  it("incident sustains elevated failure_rate for payments", async () => {
    const sim = new StreamSimulator({ speed: 4 });
    const values: number[] = [];
    sim.on("event", (e: StreamEvent) => {
      if (e.metric === "failure_rate" && e.service === "payments") {
        values.push(e.value);
      }
    });
    sim.simulateIncident();
    await wait(500);
    sim.stop();
    expect(values.some((v) => v > config.thresholds.failure_rate)).toBe(true);
  });

  it("pipeline failure pauses then recover resumes", async () => {
    const sim = new StreamSimulator({ speed: 3 });
    let count = 0;
    sim.on("event", () => {
      count += 1;
    });
    sim.startNormal();
    await wait(200);
    const before = count;
    expect(before).toBeGreaterThan(0);
    sim.simulatePipelineFailure();
    const mid = count;
    await wait(250);
    expect(count).toBe(mid);
    sim.recoverPipeline();
    await wait(400);
    expect(count).toBeGreaterThan(mid);
    sim.stop();
  });
});

describe("processing", () => {
  it("computes rolling average, deviation, z-score, rates", () => {
    const p = new ProcessingEngine();
    for (let i = 0; i < 20; i++) {
      p.ingest(evt({ value: 2 + i * 0.05, event_id: `p${i}` }));
    }
    const snap = p.getPrimarySnapshot();
    expect(snap.rolling_average).toBeGreaterThan(0);
    expect(Number.isFinite(snap.z_score)).toBe(true);
    expect(Number.isFinite(snap.percentage_deviation)).toBe(true);
    expect(snap.events_per_second).toBeGreaterThanOrEqual(0);
    expect(p.getEventRatePerMinute()).toBeGreaterThan(0);
  });
});

describe("threshold + anomaly + risk + alerts", () => {
  it("detects threshold breach with structured reason", () => {
    const breach = evaluateThreshold(
      evt({ value: config.thresholds.failure_rate + 2, status: "error" })
    );
    expect(breach.breached).toBe(true);
    expect(breach.reason.toLowerCase()).toContain("exceeding");
    expect(breach.region).toBe("north");
  });

  it("deduplicates alerts and supports state transitions", () => {
    const engine = new AlertEngine();
    const a1 = engine.createSystemAlert("reason one", "HIGH");
    const a2 = engine.createSystemAlert("reason two", "HIGH");
    expect(a1.reason.length).toBeGreaterThan(0);
    expect(a2.id).not.toBe(a1.id);

    // Dedup via maybeCreate cooldown
    const detector = new AnomalyDetector();
    const processor = new ProcessingEngine();
    for (let i = 0; i < 15; i++) processor.ingest(evt({ value: 1, event_id: `${i}` }));
    const spike = evt({ value: 12, status: "error", event_id: "spike" });
    const snap = processor.ingest(spike);
    let anomaly = detector.evaluate(spike, snap);
    for (let i = 0; i < config.anomalyConsecutiveEvents + 2; i++) {
      anomaly = detector.evaluate(spike, snap);
    }
    const risk = computeRiskScore({
      event: spike,
      snapshot: { ...snap, percentage_deviation: 400 },
      persistenceMs: anomaly.persistence_ms,
      severity: "HIGH",
      escalationRate: 5,
    });
    const first = engine.maybeCreate(spike, { ...anomaly, isAnomaly: true, severity: "HIGH", reason: "test breach reason" }, risk);
    const second = engine.maybeCreate(spike, { ...anomaly, isAnomaly: true, severity: "HIGH", reason: "test breach reason" }, risk);
    expect(first).not.toBeNull();
    expect(second).toBeNull(); // cooldown

    expect(engine.acknowledge(first!.id)?.status).toBe("ACKNOWLEDGED");
    expect(engine.resolve(first!.id)?.status).toBe("RESOLVED");
  });

  it("risk score stays 0–100 with contributors", () => {
    const risk = computeRiskScore({
      event: evt({ value: 10 }),
      snapshot: {
        ...new ProcessingEngine().ingest(evt({ value: 10 })),
        percentage_deviation: 250,
        rate_of_change: 4,
      },
      persistenceMs: 40_000,
      severity: "HIGH",
      escalationRate: 4,
    });
    expect(risk.score).toBeGreaterThanOrEqual(0);
    expect(risk.score).toBeLessThanOrEqual(100);
    expect(risk.risk_score).toBe(risk.score);
    expect(risk.contributors.length).toBeGreaterThan(0);
  });
});

describe("freshness", () => {
  it("healthy then SLA breach then recovery", async () => {
    const mon = new FreshnessMonitor();
    mon.start();
    mon.recordEvent(new Date().toISOString());
    expect(mon.getFreshness().sla_breached).toBe(false);

    const aged = new FreshnessMonitor();
    aged.recordEvent(new Date(Date.now() - 12_000).toISOString(), Date.now() - 12_000);
    const f = aged.getFreshness();
    expect(f.sla_breached).toBe(true);
    expect(["DEGRADED", "CRITICAL"]).toContain(f.status);

    aged.recordEvent(new Date().toISOString());
    expect(aged.getFreshness().sla_breached).toBe(false);
    mon.stop();
  });
});

describe("stream websocket", () => {
  let close: (() => void) | undefined;
  let port = 0;

  beforeAll(async () => {
    // Use isolated hub instance via existing singleton already started in other tests —
    // spin a dedicated HTTP server for WS only.
    const app = express();
    const server = createServer(app);
    const attachment = attachWebSocket(server);
    close = () => {
      attachment.close();
      server.close();
    };
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        port = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterAll(() => {
    close?.();
  });

  it("delivers snapshot and events, cleans up on disconnect", async () => {
    const messages: string[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("ws timeout")), 8000);
      ws.on("message", (data) => {
        messages.push(String(data));
        const msg = JSON.parse(String(data)) as { type: string };
        if (msg.type === "snapshot") {
          clearTimeout(t);
          resolve();
        }
      });
      ws.on("error", (err) => {
        clearTimeout(t);
        reject(err);
      });
    });

    expect(messages.length).toBeGreaterThan(0);
    const first = JSON.parse(messages[0]!) as { type: string };
    expect(first.type).toBe("snapshot");

    ws.close();
    await wait(200);
  });
});

describe("end-to-end engine chain", () => {
  const hub = new SentinelHub();

  beforeAll(() => hub.start());
  afterAll(() => hub.stop());

  it("normal → anomaly → incident → failure SLA → recover", async () => {
    hub.demo("START_NORMAL");
    await wait(600);
    let snap = hub.getSnapshot();
    expect(snap.kpi.events_per_minute).toBeGreaterThan(0);
    expect(snap.health.freshness.status).toBe("HEALTHY");

    // Validate event schema on live path
    const sample = await new Promise<StreamEvent>((resolve) => {
      const handler = (msg: { type: string; payload: StreamEvent }) => {
        if (msg.type === "event") {
          hub.off("message", handler as never);
          resolve(msg.payload);
        }
      };
      hub.on("message", handler as never);
    });
    expect(StreamEventSchema.parse(sample).server_timestamp).toBeTruthy();

    hub.demo("SIMULATE_INCIDENT");
    await wait(config.anomalyPersistenceMs + 3500);
    snap = hub.getSnapshot();
    expect(snap.alerts.some((a) => a.reason.length > 10)).toBe(true);

    hub.demo("SIMULATE_PIPELINE_FAILURE");
    await wait(config.freshnessSlaSeconds * 1000 + 1500);
    snap = hub.getSnapshot();
    expect(snap.health.freshness.sla_breached).toBe(true);
    expect(
      snap.alerts.some((a) => a.metric === "data_freshness")
    ).toBe(true);

    hub.demo("RECOVER_PIPELINE");
    await wait(2000);
    snap = hub.getSnapshot();
    expect(snap.health.freshness.sla_breached).toBe(false);
    expect(snap.mode).toBe("NORMAL");
    expect(hub.getSimulationState().running).toBe(true);
  }, 45_000);
});

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function avg(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
}
