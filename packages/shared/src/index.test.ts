import { describe, it, expect } from "vitest";
import {
  StreamEventSchema,
  SeveritySchema,
  SimulationStateSchema,
} from "./index.js";

describe("shared schemas", () => {
  it("validates stream events with server_timestamp", () => {
    const parsed = StreamEventSchema.parse({
      event_id: "1",
      timestamp: new Date().toISOString(),
      server_timestamp: new Date().toISOString(),
      region: "north",
      service: "payments",
      metric: "failure_rate",
      value: 1.2,
      baseline_value: 1,
      status: "ok",
      source: "test",
    });
    expect(parsed.metric).toBe("failure_rate");
    expect(parsed.server_timestamp).toBeTruthy();
  });

  it("accepts severities and simulation state", () => {
    expect(SeveritySchema.parse("CRITICAL")).toBe("CRITICAL");
    const state = SimulationStateSchema.parse({
      mode: "NORMAL",
      running: true,
      paused: false,
      target_events_per_minute: 1150,
      tick: 1,
      started_at: new Date().toISOString(),
    });
    expect(state.mode).toBe("NORMAL");
  });
});
