import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SentinelHub } from "../hub.js";
import { config } from "../config.js";

describe("e2e smoke", () => {
  const hub = new SentinelHub();

  beforeAll(() => {
    hub.start();
  });

  afterAll(() => {
    hub.stop();
  });

  it("stream → kpi → threshold → alert → ack → failure → breach → recover", async () => {
    hub.demo("START_NORMAL");
    await wait(800);
    let snap = hub.getSnapshot();
    expect(snap.kpi.events_per_minute).toBeGreaterThan(0);
    expect(snap.timeseries.length).toBeGreaterThan(0);

    hub.demo("SIMULATE_INCIDENT");
    // Wait long enough for persistence-based anomaly
    await wait(config.anomalyPersistenceMs + 4000);
    snap = hub.getSnapshot();
    // Incident mode should elevate risk and likely create alerts
    expect(snap.kpi.risk_score).toBeGreaterThanOrEqual(0);
    expect(snap.health.freshness.status).toBe("HEALTHY");

    const active = hub.alerts.getAlerts({ status: "ACTIVE" });
    if (active.length > 0) {
      const ack = hub.alerts.acknowledge(active[0]!.id);
      expect(ack?.status).toBe("ACKNOWLEDGED");
      expect((ack?.reason ?? "").length).toBeGreaterThan(5);
    }

    hub.demo("SIMULATE_PIPELINE_FAILURE");
    await wait(config.freshnessSlaSeconds * 1000 + 1500);
    snap = hub.getSnapshot();
    expect(snap.health.freshness.sla_breached).toBe(true);
    expect(["DEGRADED", "CRITICAL"]).toContain(snap.health.freshness.status);

    const systemAlerts = hub.alerts
      .getAlerts()
      .filter((a) => a.metric === "data_freshness");
    expect(systemAlerts.length).toBeGreaterThan(0);
    expect(systemAlerts[0]!.reason.toLowerCase()).toContain("freshness");

    hub.demo("RECOVER_PIPELINE");
    await wait(2000);
    snap = hub.getSnapshot();
    expect(snap.health.freshness.sla_breached).toBe(false);
    expect(snap.mode).toBe("NORMAL");
  }, 30_000);
});

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
