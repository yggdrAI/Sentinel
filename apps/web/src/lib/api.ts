import type {
  Alert,
  AuditEvent,
  DataFreshness,
  Incident,
  KpiSnapshot,
  PipelineHealth,
  RegionState,
  RiskScore,
  SimulationMode,
  SimulationState,
  StreamEvent,
  TimeSeriesPoint,
} from "@sentinel/shared";

const jsonHeaders = { "Content-Type": "application/json" };

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export type SnapshotResponse = {
  kpi: KpiSnapshot;
  health: PipelineHealth;
  alerts: Alert[];
  incidents: Incident[];
  audit?: AuditEvent[];
  timeseries: TimeSeriesPoint[];
  regions: RegionState[];
  risk: RiskScore;
  mode: SimulationMode;
};

export async function fetchSnapshot(): Promise<SnapshotResponse> {
  return parse(await fetch("/api/snapshot"));
}

export async function fetchSimulationStatus(): Promise<SimulationState> {
  return parse(await fetch("/simulation/status"));
}

export async function fetchAudit(limit = 100): Promise<AuditEvent[]> {
  return parse(await fetch(`/api/audit?limit=${limit}`));
}

export const SIMULATION_ENDPOINTS = {
  normal: "/simulation/normal",
  "high-load": "/simulation/high-load",
  anomaly: "/simulation/anomaly",
  incident: "/simulation/incident",
  failure: "/simulation/failure",
  recover: "/simulation/recover",
} as const;

export type SimulationAction = keyof typeof SIMULATION_ENDPOINTS;

export async function triggerSimulation(action: SimulationAction): Promise<{
  ok: boolean;
  simulation: SimulationState;
}> {
  return parse(
    await fetch(SIMULATION_ENDPOINTS[action], {
      method: "POST",
      headers: jsonHeaders,
    })
  );
}

export async function acknowledgeAlert(
  id: string,
  actor = "operator"
): Promise<Alert> {
  return parse(
    await fetch(`/api/alerts/${id}/acknowledge`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ actor }),
    })
  );
}

export async function assignAlert(
  id: string,
  assigned_to: string,
  actor = "operator"
): Promise<Alert> {
  return parse(
    await fetch(`/api/alerts/${id}/assign`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ assigned_to, actor }),
    })
  );
}

export async function unassignAlert(
  id: string,
  actor = "operator"
): Promise<Alert> {
  return parse(
    await fetch(`/api/alerts/${id}/unassign`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ actor }),
    })
  );
}

export async function escalateAlert(
  id: string,
  reason: string,
  actor = "operator"
): Promise<Alert> {
  return parse(
    await fetch(`/api/alerts/${id}/escalate`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ reason, actor }),
    })
  );
}

export async function resolveAlert(
  id: string,
  actor = "operator"
): Promise<Alert> {
  return parse(
    await fetch(`/api/alerts/${id}/resolve`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ actor }),
    })
  );
}

export async function runPerfTest(
  target_eps: number,
  duration_seconds = 3
): Promise<unknown> {
  return parse(
    await fetch("/api/perf/run", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ target_eps, duration_seconds }),
    })
  );
}

export type { DataFreshness, StreamEvent };
