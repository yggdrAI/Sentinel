import type {
  RiskScore,
  RiskContributor,
  Severity,
  StreamEvent,
  MetricSnapshot,
} from "@sentinel/shared";
import { config } from "../config.js";

export type RiskInput = {
  event: StreamEvent;
  snapshot: MetricSnapshot;
  persistenceMs: number;
  severity: Severity;
  escalationRate: number;
};

/**
 * Deterministic operational risk model (0–100) with explainable contributors.
 * Weights documented in config.riskWeights — not AI.
 */
export function computeRiskScore(input: RiskInput): RiskScore {
  const contributors: RiskContributor[] = [];
  const { snapshot, persistenceMs, event, escalationRate } = input;
  const w = config.riskWeights;

  const mag = Math.min(
    w.deviationMax,
    Math.abs(snapshot.percentage_deviation) / 4
  );
  if (mag >= 1) {
    contributors.push({
      label: "severe deviation",
      points: Math.round(mag),
    });
  }

  const durationPts = Math.min(w.durationMax, persistenceMs / 2000);
  if (durationPts >= 1) {
    contributors.push({
      label: "sustained duration",
      points: Math.round(durationPts),
    });
  }

  const crit = config.metricCriticality[event.metric] ?? 0.5;
  const servicePts = Math.round(crit * w.criticalityMax);
  if (servicePts >= 1) {
    contributors.push({
      label:
        crit >= 0.9
          ? "critical service/metric"
          : "affected service criticality",
      points: servicePts,
    });
  }

  if (event.region === "north" && event.service === "payments") {
    contributors.push({
      label: "high-impact region/service",
      points: w.regionBoost,
    });
  }

  const esc = Math.min(w.escalationMax, Math.abs(escalationRate) * 3);
  if (esc >= 1) {
    contributors.push({
      label: "rapid escalation",
      points: Math.round(esc),
    });
  }

  let score = contributors.reduce((a, c) => a + c.points, 0);
  score = Math.max(0, Math.min(100, score));

  const severity: Severity =
    score >= config.criticalRiskThreshold
      ? "CRITICAL"
      : score >= config.highRiskThreshold
        ? "HIGH"
        : score >= 55
          ? "MEDIUM"
          : score >= 30
            ? "LOW"
            : "INFO";

  return {
    score,
    risk_score: score,
    contributors,
    severity,
    timestamp: new Date().toISOString(),
  };
}
