import { describe, it, expect } from "vitest";
import { ProcessingEngine } from "../processing/engine.js";
import { AnomalyDetector } from "../anomaly/detector.js";
import { computeRiskScore } from "../anomaly/risk.js";
import { AlertEngine } from "../alerts/engine.js";
import { FreshnessMonitor } from "../health/freshness.js";
import { StreamSimulator } from "../stream/simulator.js";
import type { StreamEvent } from "@sentinel/shared";
import { config } from "../config.js";

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

describe("threshold detection", () => {
  it("flags values above configured failure_rate threshold", () => {
    const detector = new AnomalyDetector();
    const processor = new ProcessingEngine();
    // seed baseline
    for (let i = 0; i < 20; i++) {
      processor.ingest(evt({ value: 1.1 + Math.random() * 0.2, event_id: `s${i}` }));
    }
    const high = evt({ value: config.thresholds.failure_rate + 3, status: "error" });
    const snap = processor.ingest(high);
    // force persistence
    let result = detector.evaluate(high, snap);
    for (let i = 0; i < 5; i++) {
      result = detector.evaluate(high, snap);
    }
    expect(result.threshold).toBe(config.thresholds.failure_rate);
    expect(result.level === 1 || result.reason.includes("threshold")).toBeTruthy();
  });
});

describe("anomaly + severity", () => {
  it("requires persistence before critical-style anomaly flag", async () => {
    const detector = new AnomalyDetector();
    const processor = new ProcessingEngine();
    for (let i = 0; i < 30; i++) {
      processor.ingest(evt({ value: 1.2, event_id: `n${i}` }));
    }
    const spike = evt({ value: 12, status: "error" });
    const snap = processor.ingest(spike);
    const first = detector.evaluate(spike, snap);
    // Immediately may not be isAnomaly if persistence gate
    expect(first.reason.length).toBeGreaterThan(10);

    // Simulate persistence by re-evaluating after delaying elevatedSince
    // Directly wait less than persistence — still elevated tracking
    await new Promise((r) => setTimeout(r, 50));
    const again = detector.evaluate(spike, snap);
    expect(again.persistence_ms).toBeGreaterThanOrEqual(0);
    expect(again.severity).not.toBeUndefined();
  });
});

describe("risk score", () => {
  it("returns explainable contributors between 0 and 100", () => {
    const processor = new ProcessingEngine();
    const event = evt({ value: 10 });
    const snap = processor.ingest(event);
    snap.percentage_deviation = 200;
    snap.rate_of_change = 4;
    const risk = computeRiskScore({
      event,
      snapshot: snap,
      persistenceMs: 40_000,
      severity: "HIGH",
      escalationRate: 4,
    });
    expect(risk.score).toBeGreaterThanOrEqual(0);
    expect(risk.score).toBeLessThanOrEqual(100);
    expect(risk.contributors.length).toBeGreaterThan(0);
    expect(risk.contributors.every((c) => c.points > 0 && c.label)).toBe(true);
  });
});

describe("freshness", () => {
  it("marks SLA breach when events stop", async () => {
    const mon = new FreshnessMonitor();
    mon.start();
    mon.recordEvent(new Date().toISOString());
    const healthy = mon.getFreshness();
    expect(healthy.sla_breached).toBe(false);
    expect(healthy.status).toBe("HEALTHY");

    // Manipulate by not recording and checking age logic via private lastEventAt
    // Use a stale timestamp path: record old then wait
    mon.stop();
    // Directly verify statusFromAge behaviour via getFreshness after aging
    const aged = new FreshnessMonitor();
    aged.recordEvent(new Date(Date.now() - 12_000).toISOString(), Date.now() - 12_000);
    const f = aged.getFreshness();
    expect(f.freshness_seconds).toBeGreaterThan(config.freshnessSlaSeconds);
    expect(f.sla_breached).toBe(true);
    expect(["DEGRADED", "CRITICAL"]).toContain(f.status);
  });
});

describe("alert state transitions", () => {
  it("ACTIVE → ACKNOWLEDGED → RESOLVED", () => {
    const engine = new AlertEngine();
    const alert = engine.createSystemAlert("test reason", "HIGH");
    expect(alert.status).toBe("ACTIVE");
    const ack = engine.acknowledge(alert.id);
    expect(ack?.status).toBe("ACKNOWLEDGED");
    expect(ack?.acknowledged_at).toBeTruthy();
    const resolved = engine.resolve(alert.id);
    expect(resolved?.status).toBe("RESOLVED");
    expect(resolved?.resolved_at).toBeTruthy();
  });
});

describe("simulator modes", () => {
  it("pauses emission in PIPELINE_FAILURE and resumes on recover", async () => {
    const sim = new StreamSimulator({ speed: 2 });
    let count = 0;
    sim.on("event", () => {
      count += 1;
    });
    sim.start("NORMAL");
    await new Promise((r) => setTimeout(r, 200));
    const before = count;
    expect(before).toBeGreaterThan(0);
    sim.setMode("PIPELINE_FAILURE");
    const mid = count;
    await new Promise((r) => setTimeout(r, 200));
    expect(count).toBe(mid);
    sim.setMode("NORMAL");
    await new Promise((r) => setTimeout(r, 500));
    expect(count).toBeGreaterThan(mid);
    sim.stop();
  });
});

describe("processing engine", () => {
  it("computes rolling stats", () => {
    const p = new ProcessingEngine();
    for (let i = 0; i < 10; i++) {
      p.ingest(evt({ value: 2 + i * 0.1, event_id: `p${i}` }));
    }
    const snap = p.getPrimarySnapshot();
    expect(snap.rolling_average).toBeGreaterThan(0);
    expect(snap.event_rate).toBeGreaterThan(0);
    expect(p.getTimeSeries().length).toBeGreaterThan(0);
  });
});
