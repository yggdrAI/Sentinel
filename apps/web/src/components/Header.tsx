import type { DataFreshness, PipelineHealth } from "@sentinel/shared";
import type { ConnectionStatus } from "../lib/commandState";
import { formatAge, fmtNum, statusColor } from "../lib/format";

type Props = {
  connection: ConnectionStatus;
  freshness: DataFreshness | null;
  health: PipelineHealth | null;
  mode: string;
  view: "command" | "alerts";
  onView: (v: Props["view"]) => void;
};

export function Header({
  connection,
  freshness,
  health,
  mode,
  view,
  onView,
}: Props) {
  const live = connection === "LIVE";
  const systemLabel = freshness?.sla_breached
    ? "SLA BREACHED"
    : freshness?.status ?? health?.status ?? "—";

  return (
    <header className="border-b border-[var(--line)] bg-ink-900/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4 px-5 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-4">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-[0.08em] text-mist-100">
              SENTINEL
            </h1>
            <p className="text-xs tracking-wide text-mist-300">
              Real-Time Decision Intelligence
            </p>
          </div>

          <div
            className="flex items-center gap-2 rounded border border-[var(--line)] px-3 py-1"
            role="status"
            aria-live="polite"
            aria-label={`Connection ${connection}`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                live
                  ? "bg-signal-live animate-pulseLive"
                  : connection === "CONNECTING" || connection === "RECONNECTING"
                    ? "bg-signal-warn animate-pulseLive"
                    : "bg-signal-crit"
              }`}
              aria-hidden="true"
            />
            <span className="font-mono text-[11px] uppercase tracking-wider text-mist-200">
              {connection}
            </span>
          </div>

          <div className="hidden font-mono text-[11px] text-mist-300 lg:block">
            MODE <span className="text-signal-accent">{mode}</span>
          </div>

          <div
            className={`hidden font-mono text-[11px] font-medium md:block ${statusColor(systemLabel)}`}
            role="status"
          >
            {systemLabel === "HEALTHY" ? "System Healthy" : systemLabel}
          </div>
        </div>

        <nav
          className="flex gap-1 rounded border border-[var(--line)] bg-ink-850 p-1"
          aria-label="Primary"
        >
          {(
            [
              ["command", "Command"],
              ["alerts", "Alerts"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => onView(id)}
              className={`rounded px-3 py-1.5 text-xs font-medium transition ${
                view === id
                  ? "bg-signal-accent/20 text-signal-accent"
                  : "text-mist-300 hover:text-mist-100"
              }`}
              aria-current={view === id ? "page" : undefined}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="text-right" aria-label="Data freshness">
          <div className="font-mono text-[10px] uppercase tracking-wider text-mist-400">
            Data freshness
          </div>
          <div className="flex items-baseline justify-end gap-2">
            <span className="font-mono text-lg tabular-nums text-mist-100">
              {freshness ? formatAge(freshness.freshness_seconds) : "—"}
            </span>
            <span className="font-mono text-[11px] text-mist-400">
              SLA &lt;{freshness?.sla_seconds ?? 5}s
            </span>
            <span
              className={`font-mono text-[11px] font-medium ${statusColor(
                freshness?.sla_breached
                  ? "CRITICAL"
                  : freshness?.status ?? ""
              )}`}
            >
              {freshness?.sla_breached
                ? "SLA BREACHED"
                : freshness?.status ?? "—"}
            </span>
          </div>
          {freshness && (
            <div className="font-mono text-[10px] text-mist-400">
              ingest {fmtNum(freshness.ingestion_latency_ms, 0)}ms
              {health ? ` · clients ${health.connected_clients}` : ""}
            </div>
          )}
        </div>
      </div>

      {(connection === "OFFLINE" || connection === "RECONNECTING") && (
        <div
          className="border-t border-signal-warn/30 bg-signal-warn/10 px-5 py-2 text-center font-mono text-xs text-signal-warn"
          role="alert"
        >
          {connection === "OFFLINE"
            ? "STREAM OFFLINE"
            : "STREAM RECONNECTING — attempting to restore live feed…"}
        </div>
      )}
    </header>
  );
}
