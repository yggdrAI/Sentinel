import type { MetricSnapshot, Severity, StreamEvent } from "@sentinel/shared";
import { config } from "../config.js";
import { evaluateThreshold } from "./threshold.js";

export type AnomalyResult = {
  isAnomaly: boolean;
  level: 1 | 2 | 3 | null;
  severity: Severity;
  reason: string;
  threshold: number | null;
  z_score: number;
  percentage_deviation: number;
  persistence_ms: number;
  consecutive_elevated: number;
};

type TrackKey = string;

/**
 * Layered anomaly detection:
 * L1 threshold, L2 statistical (z-score), L3 temporal persistence.
 */
export class AnomalyDetector {
  private readonly elevatedSince = new Map<TrackKey, number>();
  private readonly consecutive = new Map<TrackKey, number>();

  evaluate(event: StreamEvent, snapshot: MetricSnapshot): AnomalyResult {
    const key = `${event.metric}|${event.region}|${event.service}`;
    const thresholdHit = evaluateThreshold(event);
    const threshold = config.thresholds[event.metric] ?? null;
    const now = Date.now();

    const l1 = thresholdHit.breached;

    const l2 =
      Math.abs(snapshot.z_score) >= config.anomalyZScoreThreshold &&
      Math.abs(snapshot.percentage_deviation) >= 25;

    const elevated = l1 || l2;
    if (elevated) {
      if (!this.elevatedSince.has(key)) this.elevatedSince.set(key, now);
      this.consecutive.set(key, (this.consecutive.get(key) ?? 0) + 1);
    } else {
      this.elevatedSince.delete(key);
      this.consecutive.delete(key);
    }

    const persistence = this.elevatedSince.has(key)
      ? now - this.elevatedSince.get(key)!
      : 0;
    const consecutiveElevated = this.consecutive.get(key) ?? 0;

    const l3 =
      elevated &&
      (persistence >= config.anomalyPersistenceMs ||
        consecutiveElevated >= config.anomalyConsecutiveEvents);

    if (!elevated) {
      return {
        isAnomaly: false,
        level: null,
        severity: "INFO",
        reason: "Within normal operating range.",
        threshold,
        z_score: snapshot.z_score,
        percentage_deviation: snapshot.percentage_deviation,
        persistence_ms: 0,
        consecutive_elevated: 0,
      };
    }

    const severity = this.severity(
      event,
      snapshot,
      threshold,
      persistence,
      l1,
      l3
    );
    const level: 1 | 2 | 3 = l3 ? 3 : l1 ? 1 : 2;
    const reason = this.explain(
      event,
      snapshot,
      threshold,
      persistence,
      level,
      thresholdHit.reason
    );

    return {
      isAnomaly:
        l3 ||
        (l1 && persistence >= 3000) ||
        (l2 && persistence >= 5000) ||
        consecutiveElevated >= config.anomalyConsecutiveEvents,
      level,
      severity,
      reason,
      threshold,
      z_score: snapshot.z_score,
      percentage_deviation: snapshot.percentage_deviation,
      persistence_ms: persistence,
      consecutive_elevated: consecutiveElevated,
    };
  }

  private severity(
    event: StreamEvent,
    snapshot: MetricSnapshot,
    threshold: number | null,
    persistence: number,
    l1: boolean,
    l3: boolean
  ): Severity {
    const mag = Math.abs(snapshot.percentage_deviation);
    if (
      l3 &&
      l1 &&
      threshold !== null &&
      event.value > threshold * 1.5 &&
      persistence > 20_000
    ) {
      return "CRITICAL";
    }
    if (l3 && (mag > 100 || (l1 && persistence > 12_000))) return "HIGH";
    if (l1 || mag > 60) return "MEDIUM";
    if (mag > 30) return "LOW";
    return "INFO";
  }

  private explain(
    event: StreamEvent,
    snapshot: MetricSnapshot,
    threshold: number | null,
    persistence: number,
    level: 1 | 2 | 3,
    thresholdReason: string
  ): string {
    const secs = Math.round(persistence / 1000);
    const parts: string[] = [];
    if (level === 1 || (threshold !== null && event.value > threshold)) {
      parts.push(thresholdReason.replace(/\.$/, ""));
    } else {
      parts.push(`${label(event.metric)} reached ${format(event.value)}`);
    }
    if (Math.abs(snapshot.percentage_deviation) >= 20) {
      parts.push(
        `${Math.abs(snapshot.percentage_deviation).toFixed(1)}% from baseline ${format(snapshot.baseline)}`
      );
    }
    if (Math.abs(snapshot.z_score) >= config.anomalyZScoreThreshold) {
      parts.push(`z-score ${snapshot.z_score.toFixed(2)}`);
    }
    if (secs > 0) {
      parts.push(`remaining elevated for ${secs} seconds`);
    }
    parts.push(`(${event.region}/${event.service}, detection L${level})`);
    return parts.join(" — ");
  }
}

function label(metric: string) {
  return metric.replace(/_/g, " ");
}

function format(n: number) {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}
