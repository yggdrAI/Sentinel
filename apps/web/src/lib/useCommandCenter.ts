import { useCallback, useEffect, useReducer, useRef } from "react";
import type { WsMessage } from "@sentinel/shared";
import {
  acknowledgeAlert as apiAck,
  assignAlert as apiAssign,
  escalateAlert as apiEscalate,
  fetchSimulationStatus,
  fetchSnapshot,
  resolveAlert as apiResolve,
  unassignAlert as apiUnassign,
  triggerSimulation,
  type SimulationAction,
} from "./api";
import {
  commandReducer,
  initialCommandState,
  type CommandState,
} from "./commandState";

const WS_URL =
  import.meta.env.VITE_WS_URL ||
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

export function useCommandCenter(): CommandState & {
  triggerDemo: (action: SimulationAction) => Promise<void>;
  acknowledge: (id: string) => Promise<void>;
  assign: (id: string, assignee: string) => Promise<void>;
  unassign: (id: string) => Promise<void>;
  escalate: (id: string, reason: string) => Promise<void>;
  resolve: (id: string) => Promise<void>;
  refreshSimulation: () => Promise<void>;
} {
  const [state, dispatch] = useReducer(commandReducer, initialCommandState);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const intentionalClose = useRef(false);

  const refreshSimulation = useCallback(async () => {
    try {
      const sim = await fetchSimulationStatus();
      dispatch({ type: "SIMULATION", payload: sim });
    } catch {
      /* optional */
    }
  }, []);

  // REST bootstrap — prevents empty dashboard while WS connects
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [snap, sim] = await Promise.all([
          fetchSnapshot(),
          fetchSimulationStatus(),
        ]);
        if (cancelled) return;
        dispatch({ type: "REST_SNAPSHOT", payload: snap });
        dispatch({ type: "SIMULATION", payload: sim });
      } catch (e) {
        if (!cancelled) {
          dispatch({
            type: "REST_ERROR",
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    intentionalClose.current = false;

    const connect = () => {
      if (
        wsRef.current &&
        (wsRef.current.readyState === WebSocket.OPEN ||
          wsRef.current.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }

      dispatch({
        type: "CONNECTION",
        status: retryRef.current > 0 ? "RECONNECTING" : "CONNECTING",
      });

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 0;
        dispatch({ type: "CONNECTION", status: "LIVE" });
        void refreshSimulation();
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as WsMessage;
          dispatch({ type: "WS_MESSAGE", message: msg });
        } catch {
          /* ignore malformed */
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (intentionalClose.current) {
          dispatch({ type: "CONNECTION", status: "OFFLINE" });
          return;
        }
        dispatch({ type: "CONNECTION", status: "RECONNECTING" });
        const delay = Math.min(10_000, 800 * 2 ** retryRef.current);
        retryRef.current += 1;
        timerRef.current = window.setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      intentionalClose.current = true;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        if (
          ws.readyState === WebSocket.OPEN ||
          ws.readyState === WebSocket.CONNECTING
        ) {
          ws.close();
        }
      }
    };
  }, [refreshSimulation]);

  const triggerDemo = useCallback(
    async (action: SimulationAction) => {
      const res = await triggerSimulation(action);
      dispatch({ type: "SIMULATION", payload: res.simulation });
    },
    []
  );

  const acknowledge = useCallback(async (id: string) => {
    const alert = await apiAck(id);
    dispatch({ type: "UPSERT_ALERT", alert });
  }, []);

  const assign = useCallback(async (id: string, assignee: string) => {
    const alert = await apiAssign(id, assignee);
    dispatch({ type: "UPSERT_ALERT", alert });
  }, []);

  const unassign = useCallback(async (id: string) => {
    const alert = await apiUnassign(id);
    dispatch({ type: "UPSERT_ALERT", alert });
  }, []);

  const escalate = useCallback(async (id: string, reason: string) => {
    const alert = await apiEscalate(id, reason);
    dispatch({ type: "UPSERT_ALERT", alert });
  }, []);

  const resolve = useCallback(async (id: string) => {
    const alert = await apiResolve(id);
    dispatch({ type: "UPSERT_ALERT", alert });
  }, []);

  return {
    ...state,
    triggerDemo,
    acknowledge,
    assign,
    unassign,
    escalate,
    resolve,
    refreshSimulation,
  };
}
