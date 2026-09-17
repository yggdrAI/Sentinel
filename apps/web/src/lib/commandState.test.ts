import { describe, it, expect } from "vitest";
import {
  commandReducer,
  initialCommandState,
  MAX_EVENT_HISTORY,
} from "./commandState";
import { SIMULATION_ENDPOINTS } from "./api";
import type { StreamEvent, WsMessage } from "@sentinel/shared";

function event(partial: Partial<StreamEvent> = {}): StreamEvent {
  const now = new Date().toISOString();
  return {
    event_id: partial.event_id ?? "e1",
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

describe("commandReducer", () => {
  it("tracks connection status", () => {
    let s = commandReducer(initialCommandState, {
      type: "CONNECTION",
      status: "CONNECTING",
    });
    expect(s.connection).toBe("CONNECTING");
    s = commandReducer(s, { type: "CONNECTION", status: "LIVE" });
    expect(s.connection).toBe("LIVE");
    s = commandReducer(s, { type: "CONNECTION", status: "RECONNECTING" });
    expect(s.connection).toBe("RECONNECTING");
    s = commandReducer(s, { type: "CONNECTION", status: "OFFLINE" });
    expect(s.connection).toBe("OFFLINE");
  });

  it("updates KPI from websocket message", () => {
    const msg: WsMessage = {
      type: "kpi",
      payload: {
        events_per_minute: 1100,
        current_value: 2.5,
        active_alerts: 1,
        critical_incidents: 0,
        risk_score: 42,
        data_freshness_seconds: 0.2,
        timestamp: new Date().toISOString(),
      },
    };
    const s = commandReducer(initialCommandState, {
      type: "WS_MESSAGE",
      message: msg,
    });
    expect(s.kpi?.events_per_minute).toBe(1100);
    expect(s.kpi?.risk_score).toBe(42);
  });

  it("appends events with bounded history", () => {
    let s = initialCommandState;
    for (let i = 0; i < MAX_EVENT_HISTORY + 20; i++) {
      s = commandReducer(s, {
        type: "WS_MESSAGE",
        message: {
          type: "event",
          payload: event({ event_id: `e${i}`, value: i }),
        },
      });
    }
    expect(s.eventHistory.length).toBe(MAX_EVENT_HISTORY);
    expect(s.latestEvent?.event_id).toBe(
      `e${MAX_EVENT_HISTORY + 19}`
    );
  });

  it("upserts alerts from websocket", () => {
    const now = new Date().toISOString();
    const alert = {
      id: "a1",
      title: "failure rate — north/payments",
      category: "failure_rate",
      created_at: now,
      updated_at: now,
      acknowledged_at: null,
      escalated_at: null,
      resolved_at: null,
      acknowledged_by: null,
      escalated_by: null,
      resolved_by: null,
      assigned_to: null,
      escalation_level: 0,
      escalation_reason: null,
      severity: "HIGH" as const,
      status: "ACTIVE" as const,
      metric: "failure_rate",
      region: "north",
      service: "payments",
      value: 8,
      threshold: 5,
      baseline: 1.2,
      reason: "exceeded threshold",
      source: "test",
      risk_score: 70,
      affected_entity: "north/payments",
      related_incident_id: null,
      evidence: null,
      history: [
        { at: now, action: "CREATED" as const, actor: "system" },
      ],
    };
    let s = commandReducer(initialCommandState, {
      type: "WS_MESSAGE",
      message: { type: "alert", payload: alert },
    });
    expect(s.alerts).toHaveLength(1);
    s = commandReducer(s, {
      type: "UPSERT_ALERT",
      alert: { ...alert, status: "ACKNOWLEDGED" },
    });
    expect(s.alerts[0]?.status).toBe("ACKNOWLEDGED");
    expect(s.alerts).toHaveLength(1);
  });

  it("appends audit events from websocket", () => {
    const s = commandReducer(initialCommandState, {
      type: "WS_MESSAGE",
      message: {
        type: "audit",
        payload: {
          id: "aud1",
          timestamp: new Date().toISOString(),
          action: "ALERT_ESCALATED",
          actor: "operator",
          entity_type: "alert",
          entity_id: "a1",
        },
      },
    });
    expect(s.audit).toHaveLength(1);
    expect(s.audit[0]?.action).toBe("ALERT_ESCALATED");
  });

  it("reflects freshness SLA breach and recovery", () => {
    const breached = {
      last_event_at: new Date().toISOString(),
      event_age_ms: 11400,
      ingestion_latency_ms: 20,
      freshness_seconds: 11.4,
      sla_seconds: 5,
      status: "CRITICAL" as const,
      sla_breached: true,
    };
    let s = commandReducer(initialCommandState, {
      type: "WS_MESSAGE",
      message: { type: "freshness", payload: breached },
    });
    expect(s.freshness?.sla_breached).toBe(true);
    expect(s.freshness?.freshness_seconds).toBe(11.4);

    s = commandReducer(s, {
      type: "WS_MESSAGE",
      message: {
        type: "freshness",
        payload: {
          ...breached,
          freshness_seconds: 0.3,
          event_age_ms: 300,
          status: "HEALTHY",
          sla_breached: false,
        },
      },
    });
    expect(s.freshness?.sla_breached).toBe(false);
    expect(s.freshness?.status).toBe("HEALTHY");
  });
});

describe("simulation endpoints", () => {
  it("maps demo actions to backend paths", () => {
    expect(SIMULATION_ENDPOINTS.normal).toBe("/simulation/normal");
    expect(SIMULATION_ENDPOINTS["high-load"]).toBe("/simulation/high-load");
    expect(SIMULATION_ENDPOINTS.anomaly).toBe("/simulation/anomaly");
    expect(SIMULATION_ENDPOINTS.incident).toBe("/simulation/incident");
    expect(SIMULATION_ENDPOINTS.failure).toBe("/simulation/failure");
    expect(SIMULATION_ENDPOINTS.recover).toBe("/simulation/recover");
  });
});
