import { useState } from "react";
import type { SimulationState } from "@sentinel/shared";
import {
  SIMULATION_ENDPOINTS,
  type SimulationAction,
} from "../lib/api";

const ACTIONS: {
  action: SimulationAction;
  label: string;
  tone?: "danger" | "ok";
}[] = [
  { action: "normal", label: "Normal", tone: "ok" },
  { action: "high-load", label: "High load" },
  { action: "anomaly", label: "Anomaly" },
  { action: "incident", label: "Critical incident" },
  { action: "failure", label: "Pipeline failure", tone: "danger" },
  { action: "recover", label: "Recover", tone: "ok" },
];

type Props = {
  simulation: SimulationState | null;
  mode: string;
  onTrigger: (action: SimulationAction) => Promise<void>;
};

const MODE_FOR_ACTION: Record<SimulationAction, string> = {
  normal: "NORMAL",
  "high-load": "HIGH_LOAD",
  anomaly: "ANOMALY",
  incident: "INCIDENT",
  failure: "PIPELINE_FAILURE",
  recover: "NORMAL",
};

export function DemoControls({ simulation, mode, onTrigger }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = simulation?.mode ?? mode;

  return (
    <section
      className="rounded-lg border border-signal-accent/30 bg-ink-900 p-4"
      aria-label="Demo mode"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-mist-100">Demo mode</h2>
          <p className="text-xs text-mist-400">
            Triggers backend simulation endpoints — does not fake data in the UI
          </p>
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span
            className="h-2 w-2 rounded-full bg-signal-accent"
            aria-hidden="true"
          />
          <span className="uppercase tracking-wider text-signal-accent">
            {current}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {ACTIONS.map((a) => {
          const active = current === MODE_FOR_ACTION[a.action];
          return (
            <button
              key={a.action}
              type="button"
              disabled={busy !== null}
              title={SIMULATION_ENDPOINTS[a.action]}
              aria-pressed={active}
              onClick={async () => {
                setBusy(a.action);
                setError(null);
                try {
                  await onTrigger(a.action);
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(null);
                }
              }}
              className={`rounded border px-3 py-2 text-xs font-medium transition disabled:opacity-50 ${
                a.tone === "danger"
                  ? "border-signal-crit/40 text-signal-crit hover:bg-signal-crit/10"
                  : a.tone === "ok"
                    ? "border-signal-live/40 text-signal-live hover:bg-signal-live/10"
                    : "border-[var(--line)] text-mist-200 hover:bg-white/5"
              } ${active ? "ring-1 ring-signal-accent/40" : ""}`}
            >
              {busy === a.action ? "…" : a.label}
            </button>
          );
        })}
      </div>
      {error && (
        <p className="mt-2 text-xs text-signal-crit" role="alert">
          {error}
        </p>
      )}
      <p className="mt-3 font-mono text-[10px] leading-relaxed text-mist-400">
        LIVE DATA → ANOMALY → THRESHOLD → RISK → ALERT → INCIDENT → RESPONSE →
        RECOVERY
      </p>
    </section>
  );
}
