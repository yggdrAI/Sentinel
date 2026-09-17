import { z } from "zod";

export const SimulationModeSchema = z.enum([
  "NORMAL",
  "HIGH_LOAD",
  "ANOMALY",
  "INCIDENT",
  "PIPELINE_FAILURE",
]);
export type SimulationMode = z.infer<typeof SimulationModeSchema>;

export const SeveritySchema = z.enum([
  "INFO",
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
]);
export type Severity = z.infer<typeof SeveritySchema>;

export const AlertStatusSchema = z.enum([
  "ACTIVE",
  "ACKNOWLEDGED",
  "ESCALATED",
  "RESOLVED",
]);
export type AlertStatus = z.infer<typeof AlertStatusSchema>;

export const AlertEvidenceSchema = z.object({
  metric: z.string(),
  value: z.number(),
  threshold: z.number().nullable(),
  baseline: z.number().nullable(),
  z_score: z.number().nullable(),
  percentage_deviation: z.number().nullable(),
  persistence_ms: z.number().nullable(),
  detection_level: z
    .union([z.literal(1), z.literal(2), z.literal(3)])
    .nullable(),
  event_id: z.string().nullable(),
  region: z.string(),
  service: z.string(),
});
export type AlertEvidence = z.infer<typeof AlertEvidenceSchema>;

export const AlertHistoryEntrySchema = z.object({
  at: z.string(),
  action: z.enum([
    "CREATED",
    "ACKNOWLEDGED",
    "ASSIGNED",
    "UNASSIGNED",
    "ESCALATED",
    "RESOLVED",
  ]),
  actor: z.string(),
  note: z.string().optional(),
});
export type AlertHistoryEntry = z.infer<typeof AlertHistoryEntrySchema>;

export const AuditActionSchema = z.enum([
  "ALERT_CREATED",
  "ALERT_ACKNOWLEDGED",
  "ALERT_ASSIGNED",
  "ALERT_UNASSIGNED",
  "ALERT_ESCALATED",
  "ALERT_RESOLVED",
  "INCIDENT_CREATED",
  "INCIDENT_UPDATED",
  "INCIDENT_RESOLVED",
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

export const AuditEventSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  action: AuditActionSchema,
  actor: z.string(),
  entity_type: z.enum(["alert", "incident"]),
  entity_id: z.string(),
  metadata: z.record(z.unknown()).optional(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const PipelineStatusSchema = z.enum([
  "HEALTHY",
  "DEGRADED",
  "CRITICAL",
  "DISCONNECTED",
]);
export type PipelineStatus = z.infer<typeof PipelineStatusSchema>;

export const RegionStatusSchema = z.enum(["NORMAL", "WARNING", "CRITICAL"]);
export type RegionStatus = z.infer<typeof RegionStatusSchema>;

export const StreamEventSchema = z.object({
  event_id: z.string(),
  timestamp: z.string(),
  server_timestamp: z.string(),
  region: z.string(),
  service: z.string(),
  metric: z.string(),
  value: z.number(),
  baseline_value: z.number(),
  status: z.enum(["ok", "warn", "error"]),
  source: z.string(),
  metadata: z
    .object({
      mode: SimulationModeSchema.optional(),
      tick: z.number().optional(),
      produced_at: z.string().optional(),
      ingestion_latency_ms: z.number().optional(),
    })
    .passthrough()
    .optional(),
});
export type StreamEvent = z.infer<typeof StreamEventSchema>;
/** Canonical domain alias */
export type Event = StreamEvent;

export const MetricSnapshotSchema = z.object({
  metric: z.string(),
  region: z.string().optional(),
  service: z.string().optional(),
  current_value: z.number(),
  rolling_average: z.number(),
  baseline: z.number(),
  rate_of_change: z.number(),
  percentage_deviation: z.number(),
  z_score: z.number(),
  std_dev: z.number(),
  event_rate: z.number(),
  events_per_second: z.number(),
  error_rate: z.number(),
  timestamp: z.string(),
});
export type MetricSnapshot = z.infer<typeof MetricSnapshotSchema>;

export const ThresholdBreachSchema = z.object({
  metric: z.string(),
  current_value: z.number(),
  threshold: z.number(),
  deviation: z.number(),
  timestamp: z.string(),
  region: z.string(),
  service: z.string(),
  reason: z.string(),
  breached: z.boolean(),
});
export type ThresholdBreach = z.infer<typeof ThresholdBreachSchema>;

export const SimulationStateSchema = z.object({
  mode: SimulationModeSchema,
  running: z.boolean(),
  paused: z.boolean(),
  target_events_per_minute: z.number(),
  tick: z.number(),
  started_at: z.string().nullable(),
});
export type SimulationState = z.infer<typeof SimulationStateSchema>;

export const RiskContributorSchema = z.object({
  label: z.string(),
  points: z.number(),
});
export type RiskContributor = z.infer<typeof RiskContributorSchema>;

export const RiskScoreSchema = z.object({
  score: z.number().min(0).max(100),
  risk_score: z.number().min(0).max(100),
  contributors: z.array(RiskContributorSchema),
  severity: SeveritySchema,
  timestamp: z.string(),
});
export type RiskScore = z.infer<typeof RiskScoreSchema>;

export const AlertSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  acknowledged_at: z.string().nullable(),
  escalated_at: z.string().nullable(),
  resolved_at: z.string().nullable(),
  acknowledged_by: z.string().nullable(),
  escalated_by: z.string().nullable(),
  resolved_by: z.string().nullable(),
  assigned_to: z.string().nullable(),
  escalation_level: z.number().int().min(0),
  escalation_reason: z.string().nullable(),
  severity: SeveritySchema,
  status: AlertStatusSchema,
  metric: z.string(),
  region: z.string(),
  service: z.string(),
  value: z.number(),
  threshold: z.number().nullable(),
  baseline: z.number().nullable(),
  reason: z.string(),
  source: z.string(),
  risk_score: z.number(),
  affected_entity: z.string(),
  related_incident_id: z.string().nullable(),
  evidence: AlertEvidenceSchema.nullable(),
  history: z.array(AlertHistoryEntrySchema),
});
export type Alert = z.infer<typeof AlertSchema>;

export const IncidentStatusSchema = z.enum([
  "ACTIVE",
  "ACKNOWLEDGED",
  "RESOLVED",
]);
export type IncidentStatus = z.infer<typeof IncidentStatusSchema>;

export const IncidentSchema = z.object({
  id: z.string(),
  incident_id: z.string(),
  created_at: z.string(),
  acknowledged_at: z.string().nullable(),
  resolved_at: z.string().nullable(),
  severity: SeveritySchema,
  title: z.string(),
  region: z.string(),
  service: z.string(),
  metric: z.string(),
  duration_seconds: z.number(),
  risk_score: z.number(),
  alert_ids: z.array(z.string()),
  related_alerts: z.array(z.string()),
  triggering_alert_id: z.string().nullable(),
  status: IncidentStatusSchema,
});
export type Incident = z.infer<typeof IncidentSchema>;

export const DataFreshnessSchema = z.object({
  last_event_at: z.string().nullable(),
  event_age_ms: z.number(),
  ingestion_latency_ms: z.number(),
  freshness_seconds: z.number(),
  sla_seconds: z.number(),
  status: PipelineStatusSchema,
  sla_breached: z.boolean(),
});
export type DataFreshness = z.infer<typeof DataFreshnessSchema>;

export const PipelineHealthSchema = z.object({
  status: PipelineStatusSchema,
  stream_connected: z.boolean(),
  connected_clients: z.number(),
  events_received: z.number(),
  events_processed: z.number(),
  processing_failures: z.number(),
  events_per_minute: z.number(),
  events_per_second: z.number(),
  processing_rate: z.number(),
  last_successful_event: z.string().nullable(),
  last_event_timestamp: z.string().nullable(),
  ingestion_latency_ms: z.number(),
  ingestion_status: z.enum(["RUNNING", "PAUSED", "FAILED", "RECOVERING"]),
  freshness: DataFreshnessSchema,
  freshness_sla_seconds: z.number(),
});
export type PipelineHealth = z.infer<typeof PipelineHealthSchema>;

export const RegionStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
  status: RegionStatusSchema,
  current_value: z.number(),
  baseline: z.number(),
  deviation: z.number(),
  risk_score: z.number(),
  active_alerts: z.number(),
});
export type RegionState = z.infer<typeof RegionStateSchema>;

export const KpiSnapshotSchema = z.object({
  events_per_minute: z.number(),
  current_value: z.number(),
  active_alerts: z.number(),
  critical_incidents: z.number(),
  risk_score: z.number(),
  data_freshness_seconds: z.number(),
  timestamp: z.string(),
});
export type KpiSnapshot = z.infer<typeof KpiSnapshotSchema>;

export const TimeSeriesPointSchema = z.object({
  t: z.number(),
  value: z.number(),
  baseline: z.number(),
  threshold: z.number(),
  anomaly: z.boolean(),
});
export type TimeSeriesPoint = z.infer<typeof TimeSeriesPointSchema>;

export const PredictionSchema = z.object({
  current_value: z.number(),
  forecast_value: z.number(),
  forecast_minutes: z.number(),
  threshold: z.number(),
  breach_eta_minutes: z.number().nullable(),
  message: z.string(),
  advisory: z.literal(true),
});
export type Prediction = z.infer<typeof PredictionSchema>;

export const AiAdvisorySchema = z.object({
  incident_id: z.string().nullable(),
  summary: z.string(),
  root_cause_hypotheses: z.array(z.string()),
  investigation_steps: z.array(z.string()),
  executive_summary: z.string(),
  advisory: z.literal(true),
  generated_at: z.string(),
});
export type AiAdvisory = z.infer<typeof AiAdvisorySchema>;

export const LoadTestResultSchema = z.object({
  target_eps: z.number(),
  duration_seconds: z.number(),
  events_sent: z.number(),
  events_processed: z.number(),
  throughput_eps: z.number(),
  avg_latency_ms: z.number(),
  p95_latency_ms: z.number(),
  p99_latency_ms: z.number(),
  dropped_events: z.number(),
  success_rate: z.number(),
  data_loss_pct: z.number(),
  started_at: z.string(),
  finished_at: z.string(),
});
export type LoadTestResult = z.infer<typeof LoadTestResultSchema>;

/** WebSocket message envelope */
export const WsMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("event"),
    payload: StreamEventSchema,
  }),
  z.object({
    type: z.literal("kpi"),
    payload: KpiSnapshotSchema,
  }),
  z.object({
    type: z.literal("metric"),
    payload: MetricSnapshotSchema,
  }),
  z.object({
    type: z.literal("alert"),
    payload: AlertSchema,
  }),
  z.object({
    type: z.literal("incident"),
    payload: IncidentSchema,
  }),
  z.object({
    type: z.literal("audit"),
    payload: AuditEventSchema,
  }),
  z.object({
    type: z.literal("health"),
    payload: PipelineHealthSchema,
  }),
  z.object({
    type: z.literal("freshness"),
    payload: DataFreshnessSchema,
  }),
  z.object({
    type: z.literal("timeseries"),
    payload: z.array(TimeSeriesPointSchema),
  }),
  z.object({
    type: z.literal("regions"),
    payload: z.array(RegionStateSchema),
  }),
  z.object({
    type: z.literal("risk"),
    payload: RiskScoreSchema,
  }),
  z.object({
    type: z.literal("prediction"),
    payload: PredictionSchema,
  }),
  z.object({
    type: z.literal("ai_advisory"),
    payload: AiAdvisorySchema,
  }),
  z.object({
    type: z.literal("heartbeat"),
    payload: z.object({
      ts: z.string(),
      clients: z.number(),
    }),
  }),
  z.object({
    type: z.literal("mode"),
    payload: z.object({
      mode: SimulationModeSchema,
    }),
  }),
  z.object({
    type: z.literal("snapshot"),
    payload: z.object({
      kpi: KpiSnapshotSchema,
      health: PipelineHealthSchema,
      alerts: z.array(AlertSchema),
      incidents: z.array(IncidentSchema),
      audit: z.array(AuditEventSchema).optional(),
      timeseries: z.array(TimeSeriesPointSchema),
      regions: z.array(RegionStateSchema),
      risk: RiskScoreSchema,
      prediction: PredictionSchema.nullable(),
      mode: SimulationModeSchema,
    }),
  }),
]);
export type WsMessage = z.infer<typeof WsMessageSchema>;

export const DemoCommandSchema = z.enum([
  "START_NORMAL",
  "SIMULATE_ANOMALY",
  "SIMULATE_INCIDENT",
  "SIMULATE_PIPELINE_FAILURE",
  "RECOVER_PIPELINE",
  "HIGH_LOAD",
  "STOP",
]);
export type DemoCommand = z.infer<typeof DemoCommandSchema>;

export const REGIONS = [
  { id: "north", name: "North", lat: 28.6139, lng: 77.209 },
  { id: "south", name: "South", lat: 12.9716, lng: 77.5946 },
  { id: "east", name: "East", lat: 22.5726, lng: 88.3639 },
  { id: "west", name: "West", lat: 19.076, lng: 72.8777 },
  { id: "central", name: "Central", lat: 23.2599, lng: 77.4126 },
] as const;

export const SERVICES = [
  "payments",
  "identity",
  "logistics",
  "telemetry",
  "grid",
] as const;

export const METRICS = [
  "transaction_volume",
  "failure_rate",
  "latency_ms",
  "throughput",
  "error_rate",
] as const;
