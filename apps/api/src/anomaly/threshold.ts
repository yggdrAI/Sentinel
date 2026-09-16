import type { StreamEvent, ThresholdBreach } from "@sentinel/shared";
import { config } from "../config.js";

const THRESHOLD_METRICS = new Set([
  "failure_rate",
  "error_rate",
  "latency_ms",
]);

/**
 * Level-1 threshold detection — configurable per metric, no UI hardcoding.
 */
export function evaluateThreshold(event: StreamEvent): ThresholdBreach {
  const threshold = config.thresholds[event.metric];
  const applicable =
    threshold !== undefined && THRESHOLD_METRICS.has(event.metric);
  const breached = applicable && event.value > threshold!;
  const deviation =
    threshold && threshold !== 0
      ? ((event.value - threshold) / threshold) * 100
      : 0;

  const reason = breached
    ? `${event.metric.replace(/_/g, " ")} reached ${fmt(event.value)}, exceeding the configured ${fmt(threshold!)} threshold (${fmt(deviation)}% over) for ${event.region}/${event.service}.`
    : applicable
      ? `${event.metric.replace(/_/g, " ")} ${fmt(event.value)} is within threshold ${fmt(threshold!)}.`
      : `No L1 threshold configured for metric ${event.metric}.`;

  return {
    metric: event.metric,
    current_value: event.value,
    threshold: threshold ?? 0,
    deviation: round(deviation, 2),
    timestamp: event.server_timestamp || event.timestamp,
    region: event.region,
    service: event.service,
    reason,
    breached: Boolean(breached),
  };
}

function fmt(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function round(n: number, d: number) {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}
