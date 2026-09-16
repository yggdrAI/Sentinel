import { useMemo, useState } from "react";
import type { Alert, Incident, RiskScore } from "@sentinel/shared";
import { SeverityBadge } from "./SeverityBadge";
import { fmtNum } from "../lib/format";

type Props = {
  incidents: Incident[];
  alerts: Alert[];
  risk: RiskScore | null;
};

export function IncidentPanel({ incidents, alerts, risk }: Props) {
  const active = incidents.filter((i) => i.status !== "RESOLVED");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = active.find((i) => i.id === selectedId) ?? null;

  const related = useMemo(() => {
    if (!selected) return [];
    const ids = new Set(selected.related_alerts ?? selected.alert_ids);
    return alerts.filter((a) => ids.has(a.id));
  }, [selected, alerts]);

  return (
    <section
      className="rounded-lg border border-[var(--line)] bg-ink-900 p-4"
      aria-label="Active incidents"
    >
      <h2 className="text-sm font-semibold text-mist-100">Active incidents</h2>
      <p className="mb-3 text-xs text-mist-400">
        Persistent anomalies linked to related alerts
      </p>

      <div className="space-y-2">
        {active.length === 0 && (
          <p className="text-sm text-mist-400">No active incidents</p>
        )}
        {active.map((i) => (
          <button
            key={i.id}
            type="button"
            onClick={() =>
              setSelectedId((prev) => (prev === i.id ? null : i.id))
            }
            className={`w-full rounded border px-3 py-2 text-left transition hover:bg-white/5 ${
              selectedId === i.id
                ? "border-signal-accent/40 bg-signal-accent/5"
                : "border-[var(--line)] bg-ink-850"
            }`}
            aria-expanded={selectedId === i.id}
          >
            <div className="flex items-center justify-between gap-2">
              <SeverityBadge severity={i.severity} />
              <span className="font-mono text-[10px] text-mist-400">
                {i.duration_seconds}s · risk {fmtNum(i.risk_score, 0)} ·{" "}
                {(i.related_alerts ?? i.alert_ids).length} alerts
              </span>
            </div>
            <div className="mt-1 text-sm text-mist-100">{i.title}</div>
            <div className="font-mono text-[10px] text-mist-400">
              {i.incident_id.slice(0, 8)}… · {i.region}/{i.service}/{i.metric} ·{" "}
              {i.status}
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <div className="mt-4 space-y-3 border-t border-[var(--line)] pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-mist-300">
            Incident detail
          </h3>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <Row k="ID" v={selected.incident_id} />
            <Row k="Status" v={selected.status} />
            <Row k="Region" v={selected.region} />
            <Row k="Service" v={selected.service} />
            <Row k="Metric" v={selected.metric} />
            <Row k="Duration" v={`${selected.duration_seconds}s`} />
            <Row k="Risk" v={fmtNum(selected.risk_score, 0)} />
            <Row
              k="Created"
              v={new Date(selected.created_at).toLocaleTimeString()}
            />
          </dl>

          <div>
            <div className="mb-1 font-mono text-[10px] uppercase text-mist-400">
              Risk contributors
            </div>
            {(risk?.contributors ?? []).length === 0 ? (
              <p className="text-xs text-mist-400">No contributors reported</p>
            ) : (
              <ul className="space-y-1">
                {(risk?.contributors ?? []).map((c) => (
                  <li
                    key={c.label}
                    className="font-mono text-[11px] text-mist-300"
                  >
                    +{c.points} {c.label}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="mb-1 font-mono text-[10px] uppercase text-mist-400">
              Related alerts
            </div>
            {related.length === 0 ? (
              <p className="text-xs text-mist-400">No related alerts loaded</p>
            ) : (
              <ul className="space-y-2">
                {related.map((a) => (
                  <li
                    key={a.id}
                    className="rounded border border-[var(--line)] px-2 py-1.5 text-xs"
                  >
                    <div className="flex justify-between gap-2">
                      <SeverityBadge severity={a.severity} />
                      <span className="font-mono text-[10px] text-mist-400">
                        {a.status}
                      </span>
                    </div>
                    <p className="mt-1 text-mist-200">{a.reason}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-mist-400">{k}</dt>
      <dd className="truncate font-mono text-mist-100">{v}</dd>
    </div>
  );
}
