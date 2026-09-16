import type { PipelineHealth, RiskScore, Prediction, AiAdvisory } from "@sentinel/shared";
import { fmtNum, statusColor } from "../lib/format";

export function SystemHealth({ health }: { health: PipelineHealth | null }) {
  if (!health) {
    return (
      <div className="rounded-xl border border-[var(--line)] bg-ink-900/90 p-4 text-sm text-mist-400">
        Awaiting stream health…
      </div>
    );
  }
  const rows = [
    ["Stream status", health.status],
    ["Ingestion", health.ingestion_status],
    ["Clients", String(health.connected_clients)],
    ["Events/min", fmtNum(health.events_per_minute, 0)],
    ["Process rate", `${fmtNum(health.processing_rate, 0)}/s`],
    ["Ingest latency", `${fmtNum(health.freshness.ingestion_latency_ms, 0)} ms`],
    ["Freshness SLA", `< ${health.freshness.sla_seconds}s`],
    [
      "Last event",
      health.last_successful_event
        ? new Date(health.last_successful_event).toLocaleTimeString()
        : "—",
    ],
  ];
  return (
    <div className="rounded-xl border border-[var(--line)] bg-ink-900/90 p-4 shadow-panel">
      <h2 className="text-sm font-semibold text-mist-100">System health</h2>
      <p className="mb-3 text-xs text-mist-400">Pipeline & freshness SLA</p>
      <dl className="space-y-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 text-xs">
            <dt className="text-mist-400">{k}</dt>
            <dd
              className={`font-mono ${k === "Stream status" ? statusColor(String(v)) : "text-mist-100"}`}
            >
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function RiskPanel({ risk }: { risk: RiskScore | null }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-ink-900/90 p-4 shadow-panel">
      <h2 className="text-sm font-semibold text-mist-100">Risk score</h2>
      <div className="mt-2 flex items-end gap-3">
        <span className="font-mono text-4xl font-semibold text-mist-100">
          {risk ? risk.score : "—"}
        </span>
        <span className="mb-1 font-mono text-xs text-mist-400">/ 100</span>
      </div>
      <ul className="mt-3 space-y-1">
        {(risk?.contributors ?? []).map((c) => (
          <li
            key={c.label}
            className="flex justify-between font-mono text-[11px] text-mist-300"
          >
            <span>+{c.points} {c.label}</span>
          </li>
        ))}
        {!risk?.contributors?.length && (
          <li className="text-xs text-mist-400">No elevated risk factors</li>
        )}
      </ul>
    </div>
  );
}

export function PredictionPanel({ prediction }: { prediction: Prediction | null }) {
  if (!prediction) return null;
  return (
    <div className="rounded-xl border border-[var(--line)] bg-ink-900/90 p-4 shadow-panel">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-mist-100">Short-term forecast</h2>
        <span className="rounded bg-signal-info/15 px-2 py-0.5 font-mono text-[9px] uppercase text-signal-info">
          Advisory
        </span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-mist-200">{prediction.message}</p>
      <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-[10px] text-mist-400">
        <div>
          Now
          <div className="text-sm text-mist-100">{fmtNum(prediction.current_value)}</div>
        </div>
        <div>
          +{prediction.forecast_minutes}m
          <div className="text-sm text-mist-100">{fmtNum(prediction.forecast_value)}</div>
        </div>
        <div>
          Threshold
          <div className="text-sm text-mist-100">{fmtNum(prediction.threshold)}</div>
        </div>
      </div>
    </div>
  );
}

export function AdvisoryPanel({ advisory }: { advisory: AiAdvisory | null }) {
  if (!advisory) return null;
  return (
    <div className="rounded-xl border border-[var(--line)] bg-ink-900/90 p-4 shadow-panel">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-mist-100">Decision support</h2>
        <span className="rounded bg-signal-info/15 px-2 py-0.5 font-mono text-[9px] uppercase text-signal-info">
          AI advisory
        </span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-mist-200">{advisory.summary}</p>
      <p className="mt-2 text-[11px] italic text-mist-400">{advisory.executive_summary}</p>
      <div className="mt-3">
        <div className="font-mono text-[10px] uppercase text-mist-400">Investigate</div>
        <ol className="mt-1 list-decimal space-y-1 pl-4 text-xs text-mist-200">
          {advisory.investigation_steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}
