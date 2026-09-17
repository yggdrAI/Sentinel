import type {
  Alert,
  AuditEvent,
  DataFreshness,
  Incident,
  KpiSnapshot,
  PipelineHealth,
  RiskScore,
  SimulationMode,
  SimulationState,
  StreamEvent,
  TimeSeriesPoint,
  WsMessage,
} from "@sentinel/shared";
import type { SnapshotResponse } from "./api";

export type ConnectionStatus =
  | "CONNECTING"
  | "LIVE"
  | "RECONNECTING"
  | "OFFLINE";

export const MAX_EVENT_HISTORY = 80;
export const MAX_TIMESERIES = 120;
export const MAX_ALERTS = 200;
export const MAX_AUDIT = 200;

export type CommandState = {
  connection: ConnectionStatus;
  kpi: KpiSnapshot | null;
  health: PipelineHealth | null;
  freshness: DataFreshness | null;
  alerts: Alert[];
  incidents: Incident[];
  audit: AuditEvent[];
  timeseries: TimeSeriesPoint[];
  risk: RiskScore | null;
  mode: SimulationMode;
  simulation: SimulationState | null;
  eventHistory: StreamEvent[];
  latestEvent: StreamEvent | null;
  lastHeartbeat: string | null;
  restError: string | null;
  bootstrapped: boolean;
};

export const initialCommandState: CommandState = {
  connection: "CONNECTING",
  kpi: null,
  health: null,
  freshness: null,
  alerts: [],
  incidents: [],
  audit: [],
  timeseries: [],
  risk: null,
  mode: "NORMAL",
  simulation: null,
  eventHistory: [],
  latestEvent: null,
  lastHeartbeat: null,
  restError: null,
  bootstrapped: false,
};

export type CommandAction =
  | { type: "CONNECTION"; status: ConnectionStatus }
  | { type: "REST_SNAPSHOT"; payload: SnapshotResponse }
  | { type: "SIMULATION"; payload: SimulationState }
  | { type: "REST_ERROR"; error: string }
  | { type: "WS_MESSAGE"; message: WsMessage }
  | { type: "UPSERT_ALERT"; alert: Alert };

export function commandReducer(
  state: CommandState,
  action: CommandAction
): CommandState {
  switch (action.type) {
    case "CONNECTION":
      return { ...state, connection: action.status };
    case "REST_ERROR":
      return { ...state, restError: action.error };
    case "SIMULATION":
      return {
        ...state,
        simulation: action.payload,
        mode: action.payload.mode,
      };
    case "REST_SNAPSHOT":
      return {
        ...state,
        bootstrapped: true,
        restError: null,
        kpi: action.payload.kpi,
        health: action.payload.health,
        freshness: action.payload.health.freshness,
        alerts: action.payload.alerts.slice(0, MAX_ALERTS),
        incidents: action.payload.incidents,
        audit: (action.payload.audit ?? []).slice(0, MAX_AUDIT),
        timeseries: action.payload.timeseries.slice(-MAX_TIMESERIES),
        risk: action.payload.risk,
        mode: action.payload.mode,
      };
    case "UPSERT_ALERT": {
      const rest = state.alerts.filter((a) => a.id !== action.alert.id);
      return {
        ...state,
        alerts: [action.alert, ...rest].slice(0, MAX_ALERTS),
      };
    }
    case "WS_MESSAGE":
      return applyWsMessage(state, action.message);
    default:
      return state;
  }
}

function applyWsMessage(state: CommandState, msg: WsMessage): CommandState {
  switch (msg.type) {
    case "snapshot":
      return {
        ...state,
        bootstrapped: true,
        mode: msg.payload.mode,
        kpi: msg.payload.kpi,
        health: msg.payload.health,
        freshness: msg.payload.health.freshness,
        alerts: msg.payload.alerts.slice(0, MAX_ALERTS),
        incidents: msg.payload.incidents,
        audit: (msg.payload.audit ?? state.audit).slice(0, MAX_AUDIT),
        timeseries: msg.payload.timeseries.slice(-MAX_TIMESERIES),
        risk: msg.payload.risk,
      };
    case "kpi":
      return { ...state, kpi: msg.payload };
    case "health":
      return {
        ...state,
        health: msg.payload,
        freshness: msg.payload.freshness,
      };
    case "freshness":
      return { ...state, freshness: msg.payload };
    case "timeseries":
      return {
        ...state,
        timeseries: msg.payload.slice(-MAX_TIMESERIES),
      };
    case "risk":
      return { ...state, risk: msg.payload };
    case "mode":
      return {
        ...state,
        mode: msg.payload.mode,
        simulation: state.simulation
          ? { ...state.simulation, mode: msg.payload.mode }
          : state.simulation,
      };
    case "alert": {
      const rest = state.alerts.filter((a) => a.id !== msg.payload.id);
      return {
        ...state,
        alerts: [msg.payload, ...rest].slice(0, MAX_ALERTS),
      };
    }
    case "incident": {
      const rest = state.incidents.filter((i) => i.id !== msg.payload.id);
      return {
        ...state,
        incidents: [msg.payload, ...rest].slice(0, 100),
      };
    }
    case "audit": {
      const rest = state.audit.filter((a) => a.id !== msg.payload.id);
      return {
        ...state,
        audit: [msg.payload, ...rest].slice(0, MAX_AUDIT),
      };
    }
    case "event": {
      const event = msg.payload;
      return {
        ...state,
        latestEvent: event,
        eventHistory: [event, ...state.eventHistory].slice(
          0,
          MAX_EVENT_HISTORY
        ),
      };
    }
    case "heartbeat":
      return { ...state, lastHeartbeat: msg.payload.ts };
    default:
      return state;
  }
}
