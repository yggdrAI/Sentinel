import "dotenv/config";

function num(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

/** Alias: SIMULATION_EVENT_RATE (events/min) falls back to NORMAL_EVENTS_PER_MINUTE */
const simulationEventRate = num(
  "SIMULATION_EVENT_RATE",
  num("NORMAL_EVENTS_PER_MINUTE", 1150)
);

/** Alias: ANOMALY_SENSITIVITY maps to z-score threshold (lower = more sensitive) */
const anomalySensitivity = num(
  "ANOMALY_SENSITIVITY",
  num("ANOMALY_Z_SCORE_THRESHOLD", 2.5)
);

export const config = {
  port: num("PORT", 4000),
  corsOrigin: str("CORS_ORIGIN", "http://localhost:5173"),
  freshnessSlaSeconds: num("FRESHNESS_SLA_SECONDS", 5),
  highRiskThreshold: num("HIGH_RISK_THRESHOLD", 80),
  criticalRiskThreshold: num("CRITICAL_RISK_THRESHOLD", 90),
  simulationSpeed: num("SIMULATION_SPEED", 1),
  normalEventsPerMinute: simulationEventRate,
  highLoadEventsPerMinute: num("HIGH_LOAD_EVENTS_PER_MINUTE", 4500),
  rollingWindowSize: num("ROLLING_WINDOW_SIZE", 60),
  anomalyZScoreThreshold: anomalySensitivity,
  anomalyPersistenceMs: num("ANOMALY_PERSISTENCE_MS", 8000),
  anomalyConsecutiveEvents: num("ANOMALY_CONSECUTIVE_EVENTS", 3),
  primaryMetric: str("PRIMARY_METRIC", "failure_rate"),
  thresholds: {
    failure_rate: num("THRESHOLD_FAILURE_RATE", 5),
    error_rate: num("THRESHOLD_ERROR_RATE", 3),
    latency_ms: num("THRESHOLD_LATENCY_MS", 400),
    transaction_volume: num("THRESHOLD_TRANSACTION_VOLUME", 2000),
    throughput: num("THRESHOLD_THROUGHPUT", 5000),
  } as Record<string, number>,
  metricCriticality: {
    failure_rate: 1.0,
    error_rate: 0.95,
    latency_ms: 0.8,
    transaction_volume: 0.6,
    throughput: 0.7,
  } as Record<string, number>,
  /** Documented risk contributor caps */
  riskWeights: {
    deviationMax: 35,
    durationMax: 25,
    criticalityMax: 20,
    escalationMax: 15,
    regionBoost: 8,
  },
  logLevel: str("LOG_LEVEL", "info"),
} as const;

export type AppConfig = typeof config;
