import type { KpiSnapshot, DataFreshness } from "@sentinel/shared";
import { formatAge, fmtNum } from "../lib/format";

type Props = {
  kpi: KpiSnapshot | null;
  freshness: DataFreshness | null;
  activeIncidents: number;
};

export function KpiStrip({ kpi, freshness, activeIncidents }: Props) {
  const cells = [
    {
      label: "Events/min",
      value: kpi ? fmtNum(kpi.events_per_minute, 0) : "—",
    },
    {
      label: "Current value",
      value: kpi ? fmtNum(kpi.current_value, 2) : "—",
    },
    {
      label: "Active alerts",
      value: kpi ? fmtNum(kpi.active_alerts, 0) : "—",
    },
    {
      label: "Active incidents",
      value: fmtNum(activeIncidents, 0),
    },
    {
      label: "Risk score",
      value: kpi ? fmtNum(kpi.risk_score, 0) : "—",
    },
    {
      label: "Data freshness",
      value: freshness
        ? formatAge(freshness.freshness_seconds)
        : kpi
          ? formatAge(kpi.data_freshness_seconds)
          : "—",
      sub: `SLA <${freshness?.sla_seconds ?? 5}s`,
    },
  ];

  return (
    <section
      className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--line)] sm:grid-cols-3 lg:grid-cols-6"
      aria-label="Live KPIs"
    >
      {cells.map((c) => (
        <div key={c.label} className="bg-ink-900 px-4 py-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-mist-400">
            {c.label}
          </div>
          <div className="mt-1 font-mono text-2xl font-medium tabular-nums text-mist-100">
            {c.value}
          </div>
          {"sub" in c && c.sub && (
            <div className="mt-0.5 font-mono text-[10px] text-mist-400">
              {c.sub}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
