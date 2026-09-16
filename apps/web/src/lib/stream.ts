import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Alert,
  AiAdvisory,
  DataFreshness,
  Incident,
  KpiSnapshot,
  PipelineHealth,
  Prediction,
  RegionState,
  RiskScore,
  SimulationMode,
  TimeSeriesPoint,
  WsMessage,
} from "@sentinel/shared";

const WS_URL =
  import.meta.env.VITE_WS_URL ||
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:4000/ws`;

export type StreamState = {
  connected: boolean;
  reconnecting: boolean;
  mode: SimulationMode;
  kpi: KpiSnapshot | null;
  health: PipelineHealth | null;
  freshness: DataFreshness | null;
  alerts: Alert[];
  incidents: Incident[];
  timeseries: TimeSeriesPoint[];
  regions: RegionState[];
  risk: RiskScore | null;
  prediction: Prediction | null;
  advisory: AiAdvisory | null;
  lastHeartbeat: string | null;
};

const initial: StreamState = {
  connected: false,
  reconnecting: false,
  mode: "NORMAL",
  kpi: null,
  health: null,
  freshness: null,
  alerts: [],
  incidents: [],
  timeseries: [],
  regions: [],
  risk: null,
  prediction: null,
  advisory: null,
  lastHeartbeat: null,
};

export function useSentinelStream() {
  const [state, setState] = useState<StreamState>(initial);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const applyMessage = useCallback((msg: WsMessage) => {
    setState((prev) => {
      switch (msg.type) {
        case "snapshot":
          return {
            ...prev,
            mode: msg.payload.mode,
            kpi: msg.payload.kpi,
            health: msg.payload.health,
            freshness: msg.payload.health.freshness,
            alerts: msg.payload.alerts,
            incidents: msg.payload.incidents,
            timeseries: msg.payload.timeseries,
            regions: msg.payload.regions,
            risk: msg.payload.risk,
            prediction: msg.payload.prediction,
          };
        case "kpi":
          return { ...prev, kpi: msg.payload };
        case "health":
          return {
            ...prev,
            health: msg.payload,
            freshness: msg.payload.freshness,
          };
        case "freshness":
          return { ...prev, freshness: msg.payload };
        case "timeseries":
          return { ...prev, timeseries: msg.payload };
        case "regions":
          return { ...prev, regions: msg.payload };
        case "risk":
          return { ...prev, risk: msg.payload };
        case "prediction":
          return { ...prev, prediction: msg.payload };
        case "ai_advisory":
          return { ...prev, advisory: msg.payload };
        case "mode":
          return { ...prev, mode: msg.payload.mode };
        case "alert": {
          const rest = prev.alerts.filter((a) => a.id !== msg.payload.id);
          return { ...prev, alerts: [msg.payload, ...rest].slice(0, 200) };
        }
        case "incident": {
          const rest = prev.incidents.filter((i) => i.id !== msg.payload.id);
          return {
            ...prev,
            incidents: [msg.payload, ...rest].slice(0, 100),
          };
        }
        case "heartbeat":
          return { ...prev, lastHeartbeat: msg.payload.ts };
        default:
          return prev;
      }
    });
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
    setState((s) => ({ ...s, reconnecting: retryRef.current > 0 }));
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      retryRef.current = 0;
      setState((s) => ({ ...s, connected: true, reconnecting: false }));
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as WsMessage;
        applyMessage(msg);
      } catch {
        /* ignore */
      }
    };

    ws.onclose = () => {
      setState((s) => ({ ...s, connected: false }));
      const delay = Math.min(10_000, 800 * 2 ** retryRef.current);
      retryRef.current += 1;
      timerRef.current = window.setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [applyMessage]);

  useEffect(() => {
    let cancelled = false;
    const connectSafe = () => {
      if (cancelled) return;
      connect();
    };
    connectSafe();
    return () => {
      cancelled = true;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      }
    };
  }, [connect]);

  return state;
}

export async function sendDemoCommand(command: string) {
  const res = await fetch("/api/demo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command }),
  });
  if (!res.ok) throw new Error("Demo command failed");
  return res.json();
}

export async function acknowledgeAlert(id: string) {
  const res = await fetch(`/api/alerts/${id}/acknowledge`, { method: "POST" });
  if (!res.ok) throw new Error("Acknowledge failed");
  return res.json();
}

export async function resolveAlert(id: string) {
  const res = await fetch(`/api/alerts/${id}/resolve`, { method: "POST" });
  if (!res.ok) throw new Error("Resolve failed");
  return res.json();
}

export async function runPerfTest(target_eps: number, duration_seconds = 3) {
  const res = await fetch("/api/perf/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target_eps, duration_seconds }),
  });
  if (!res.ok) throw new Error("Load test failed");
  return res.json();
}
