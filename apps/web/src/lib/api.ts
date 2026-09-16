import type {
  Alert,
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

export async function fetchFreshnessHealth(): Promise<PipelineHealth> {
  return parse(await fetch("/health/stream"));
}

/** Maps UI demo actions to real backend simulation endpoints */
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
  const path = SIMULATION_ENDPOINTS[action];
  return parse(
    await fetch(path, {
      method: "POST",
      headers: jsonHeaders,
    })
  );
}

export async function acknowledgeAlert(id: string): Promise<Alert> {
  return parse(
    await fetch(`/api/alerts/${id}/acknowledge`, { method: "POST" })
  );
}

export async function resolveAlert(id: string): Promise<Alert> {
  return parse(await fetch(`/api/alerts/${id}/resolve`, { method: "POST" }));
}

export type { DataFreshness, StreamEvent };
