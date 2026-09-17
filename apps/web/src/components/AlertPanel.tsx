import type { Alert } from "@sentinel/shared";
import { SeverityBadge } from "./SeverityBadge";
import { fmtNum } from "../lib/format";

type Props = {
  alerts: Alert[];
  compact?: boolean;
  onAcknowledge?: (id: string) => Promise<void>;
  onResolve?: (id: string) => Promise<void>;
};

function sortAlerts(alerts: Alert[]): Alert[] {
  const rank: Record<string, number> = {
    CRITICAL: 5,
    HIGH: 4,
    MEDIUM: 3,
    LOW: 2,
    INFO: 1,
  };
  return [...alerts].sort((a, b) => {
    const statusScore =
      (a.status === "ACTIVE" ? 2 : a.status === "ACKNOWLEDGED" ? 1 : 0) -
      (b.status === "ACTIVE" ? 2 : b.status === "ACKNOWLEDGED" ? 1 : 0);
    if (statusScore !== 0) return -statusScore;
    const sev = (rank[b.severity] ?? 0) - (rank[a.severity] ?? 0);
    if (sev !== 0) return sev;
    return (
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  });
}

export function AlertPanel({
  alerts,
  compact,
  onAcknowledge,
  onResolve,
}: Props) {
  const list = sortAlerts(alerts).slice(0, compact ? 10 : alerts.length);

  return (
    <section
      className="flex h-full flex-col rounded-lg border border-[var(--line)] bg-ink-900"
      aria-label="Active alerts"
    >
      <div className="border-b border-[var(--line)] px-4 py-3">
        <h2 className="text-sm font-semibold text-mist-100">Active alerts</h2>
        <p className="text-xs text-mist-400">
          Every alert includes a backend-generated explanation
        </p>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {list.length === 0 && (
          <p className="px-2 py-6 text-center text-sm text-mist-400">
            No alerts — stream within normal bounds
          </p>
        )}
        {list.map((a) => (
          <article
            key={a.id}
            className="rounded border border-[var(--line)] bg-ink-850 px-3 py-2.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={a.severity} />
                  <span className="font-mono text-[10px] text-mist-400">
                    {a.status}
                  </span>
                </div>
                <div className="mt-1 text-sm font-medium text-mist-100">
                  {a.title ?? a.metric.replace(/_/g, " ")}
                </div>
                <div className="font-mono text-[10px] capitalize text-mist-400">
                  {a.region} region · {a.service}
                  {a.assigned_to ? ` · ${a.assigned_to}` : ""}
                </div>
              </div>
              <div className="shrink-0 text-right font-mono text-[10px] text-mist-400">
                <div>{new Date(a.created_at).toLocaleTimeString()}</div>
                <div>risk {fmtNum(a.risk_score, 0)}</div>
              </div>
            </div>

            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-mist-300">
              <div>
                Value{" "}
                <span className="text-mist-100">{fmtNum(a.value, 2)}</span>
              </div>
              <div>
                Threshold{" "}
                <span className="text-mist-100">
                  {a.threshold == null ? "—" : fmtNum(a.threshold, 2)}
                </span>
              </div>
            </dl>

            <p className="mt-2 text-xs leading-relaxed text-mist-200">
              {a.reason}
            </p>

            {!compact && a.status !== "RESOLVED" && (
              <div className="mt-2 flex gap-2">
                {a.status === "ACTIVE" && onAcknowledge && (
                  <button
                    type="button"
                    className="rounded border border-[var(--line)] px-2 py-1 text-[10px] uppercase tracking-wide text-mist-200 hover:bg-white/5"
                    onClick={() => void onAcknowledge(a.id)}
                  >
                    Acknowledge
                  </button>
                )}
                {onResolve && (
                  <button
                    type="button"
                    className="rounded border border-signal-accent/30 px-2 py-1 text-[10px] uppercase tracking-wide text-signal-accent hover:bg-signal-accent/10"
                    onClick={() => void onResolve(a.id)}
                  >
                    Resolve
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
