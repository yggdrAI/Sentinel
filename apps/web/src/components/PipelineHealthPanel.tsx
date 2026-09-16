import type { PipelineHealth, DataFreshness } from "@sentinel/shared";
import { formatAge, fmtNum, statusColor } from "../lib/format";

type Props = {
  health: PipelineHealth | null;
  freshness: DataFreshness | null;
};

export function PipelineHealthPanel({ health, freshness }: Props) {
  if (!health || !freshness) {
    return (
      <section className="rounded-lg border border-[var(--line)] bg-ink-900 p-4 text-sm text-mist-400">
        Awaiting pipeline health from backend…
      </section>
    );
  }

  const freshnessLabel = freshness.sla_breached
    ? "SLA BREACHED"
    : freshness.status;

  const rows: [string, string, string?][] = [
    ["Stream status", health.status, statusColor(health.status)],
    ["Ingestion", health.ingestion_status],
    [
      "Last event",
      freshness.event_age_ms < 0
        ? "—"
        : `${formatAge(freshness.freshness_seconds)} ago`,
    ],
    ["Ingestion latency", `${fmtNum(health.ingestion_latency_ms, 0)} ms`],
    ["Events processed", fmtNum(health.events_processed, 0)],
    ["Events / sec", fmtNum(health.events_per_second, 1)],
    ["Events / min", fmtNum(health.events_per_minute, 0)],
    ["Connected clients", String(health.connected_clients)],
    ["Processing failures", String(health.processing_failures)],
    [
      "Data freshness",
      formatAge(freshness.freshness_seconds),
      statusColor(freshnessLabel),
    ],
    ["Freshness SLA", `< ${freshness.sla_seconds} sec`],
    ["Freshness state", freshnessLabel, statusColor(freshnessLabel)],
  ];

  return (
    <section
      className="rounded-lg border border-[var(--line)] bg-ink-900 p-4"
      aria-label="Pipeline health"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-mist-100">Pipeline health</h2>
          <p className="text-xs text-mist-400">PS34 freshness SLA monitor</p>
        </div>
        <span
          className={`font-mono text-[11px] font-semibold uppercase ${statusColor(health.status)}`}
          role="status"
        >
          {health.status}
        </span>
      </div>

      <div
        className={`mb-4 rounded border px-3 py-2 ${
          freshness.sla_breached
            ? "border-signal-crit/40 bg-signal-crit/10"
            : freshness.status === "DEGRADED"
              ? "border-signal-warn/40 bg-signal-warn/10"
              : "border-signal-live/30 bg-signal-live/5"
        }`}
      >
        <div className="font-mono text-[10px] uppercase tracking-wider text-mist-400">
          Data freshness
        </div>
        <div className="mt-1 flex items-baseline gap-3">
          <span className="font-mono text-2xl tabular-nums text-mist-100">
            {formatAge(freshness.freshness_seconds)}
          </span>
          <span className="font-mono text-xs text-mist-400">
            SLA &lt;{freshness.sla_seconds}s
          </span>
          <span
            className={`font-mono text-xs font-semibold ${statusColor(freshnessLabel)}`}
          >
            {freshnessLabel}
          </span>
        </div>
      </div>

      <dl className="space-y-2">
        {rows.map(([k, v, color]) => (
          <div key={k} className="flex justify-between gap-3 text-xs">
            <dt className="text-mist-400">{k}</dt>
            <dd className={`font-mono tabular-nums ${color ?? "text-mist-100"}`}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
