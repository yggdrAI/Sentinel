import { describe, it, expect } from "vitest";
import { AlertEngine } from "../alerts/engine.js";
import { AnomalyDetector } from "../anomaly/detector.js";
import { ProcessingEngine } from "../processing/engine.js";
import { computeRiskScore } from "../anomaly/risk.js";
import type { StreamEvent } from "@sentinel/shared";

function evt(partial: Partial<StreamEvent> = {}): StreamEvent {
  const now = new Date().toISOString();
  return {
    event_id: "e1",
    timestamp: now,
    server_timestamp: now,
    region: "north",
    service: "payments",
    metric: "failure_rate",
    value: 8,
    baseline_value: 1.2,
    status: "error",
    source: "test",
    ...partial,
  };
}

describe("alert operational workflow", () => {
  it("creates alert with evidence and audit", () => {
    const engine = new AlertEngine();
    const alert = engine.createSystemAlert("freshness breached", "CRITICAL");
    expect(alert.status).toBe("ACTIVE");
    expect(alert.title).toContain("freshness");
    expect(alert.history[0]?.action).toBe("CREATED");
    expect(engine.getAudit()[0]?.action).toBe("ALERT_CREATED");
  });

  it("ACTIVE → ACKNOWLEDGED → ESCALATED → RESOLVED", () => {
    const engine = new AlertEngine();
    const alert = engine.createSystemAlert("test", "HIGH");

    expect(engine.acknowledge(alert.id, "alice")?.status).toBe("ACKNOWLEDGED");
    expect(engine.getAlert(alert.id)?.acknowledged_by).toBe("alice");

    const esc = engine.escalate(alert.id, "Needs on-call", "alice");
    expect(esc?.status).toBe("ESCALATED");
    expect(esc?.escalation_level).toBe(1);
    expect(esc?.escalation_reason).toBe("Needs on-call");
    expect(esc?.related_incident_id).toBeTruthy();

    const resolved = engine.resolve(alert.id, "alice");
    expect(resolved?.status).toBe("RESOLVED");
    expect(resolved?.resolved_by).toBe("alice");

    const actions = engine.getAudit().map((a) => a.action);
    expect(actions).toContain("ALERT_ACKNOWLEDGED");
    expect(actions).toContain("ALERT_ESCALATED");
    expect(actions).toContain("ALERT_RESOLVED");
    expect(actions).toContain("INCIDENT_CREATED");
  });

  it("rejects invalid escalate from RESOLVED", () => {
    const engine = new AlertEngine();
    const alert = engine.createSystemAlert("x", "HIGH");
    engine.resolve(alert.id);
    expect(engine.escalate(alert.id, "too late")).toBeNull();
  });

  it("assign and unassign", () => {
    const engine = new AlertEngine();
    const alert = engine.createSystemAlert("x", "MEDIUM");
    expect(engine.assign(alert.id, "bob")?.assigned_to).toBe("bob");
    expect(engine.unassign(alert.id)?.assigned_to).toBeNull();
    expect(engine.getAudit().some((a) => a.action === "ALERT_ASSIGNED")).toBe(
      true
    );
  });

  it("links alert to incident on high severity create", () => {
    const engine = new AlertEngine();
    const processor = new ProcessingEngine();
    const detector = new AnomalyDetector();
    for (let i = 0; i < 20; i++) {
      processor.ingest(evt({ value: 1.2, event_id: `n${i}`, status: "ok" }));
    }
    const spike = evt({ value: 12, event_id: "spike" });
    const snap = processor.ingest(spike);
    let anomaly = detector.evaluate(spike, snap);
    for (let i = 0; i < 5; i++) anomaly = detector.evaluate(spike, snap);
    const risk = computeRiskScore({
      event: spike,
      snapshot: { ...snap, percentage_deviation: 400 },
      persistenceMs: 20_000,
      severity: "HIGH",
      escalationRate: 5,
    });
    const created = engine.maybeCreate(
      spike,
      {
        ...anomaly,
        isAnomaly: true,
        severity: "HIGH",
        reason: "threshold exceeded for test",
        level: 1,
      },
      risk
    );
    expect(created).not.toBeNull();
    expect(created!.evidence?.value).toBe(12);
    const incidents = engine.getIncidents();
    expect(incidents.length).toBeGreaterThan(0);
    expect(incidents[0]!.triggering_alert_id).toBe(created!.id);
    expect(created!.related_incident_id).toBe(incidents[0]!.id);
  });
});
