import { useMemo, useState } from "react";
import type {
  Alert,
  AuditEvent,
  Incident,
  StreamEvent,
} from "@sentinel/shared";
import { SeverityBadge } from "./SeverityBadge";
import { fmtNum } from "../lib/format";

type Props = {
  alert: Alert;
  incidents: Incident[];
  audit: AuditEvent[];
  events: StreamEvent[];
  onClose: () => void;
  onAcknowledge: (id: string) => Promise<void>;
  onAssign: (id: string, assignee: string) => Promise<void>;
  onUnassign: (id: string) => Promise<void>;
  onEscalate: (id: string, reason: string) => Promise<void>;
  onResolve: (id: string) => Promise<void>;
};

const LIFECYCLE = [
  "CREATED",
  "ACKNOWLEDGED",
  "ESCALATED",
  "RESOLVED",
] as const;

export function AlertDetailDrawer({
  alert,
  incidents,
  audit,
  events,
  onClose,
  onAcknowledge,
  onAssign,
  onUnassign,
  onEscalate,
  onResolve,
}: Props) {
  const [assignee, setAssignee] = useState(alert.assigned_to ?? "");
  const [escReason, setEscReason] = useState(
    alert.escalation_reason ?? "Requires elevated response"
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const incident = incidents.find(
    (i) =>
      i.id === alert.related_incident_id || i.alert_ids.includes(alert.id)
  );

  const relatedEvents = useMemo(() => {
    const eid = alert.evidence?.event_id;
    return events
      .filter(
        (e) =>
          (eid && e.event_id === eid) ||
          (e.region === alert.region &&
            e.service === alert.service &&
            e.metric === alert.metric)
      )
      .slice(0, 12);
  }, [events, alert]);

  const alertAudit = audit.filter(
    (a) => a.entity_type === "alert" && a.entity_id === alert.id
  );

  const reached = new Set(alert.history.map((h) => h.action));

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-label="Alert detail"
    >
      <button
        type="button"
        className="flex-1 cursor-default"
        aria-label="Close drawer"
        onClick={onClose}
      />
      <aside className="flex h-full w-full max-w-xl flex-col border-l border-[var(--line)] bg-ink-900 shadow-panel">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={alert.severity} />
              <span className="font-mono text-[10px] uppercase text-mist-400">
                {alert.status}
              </span>
            </div>
            <h3 className="mt-2 text-lg font-semibold text-mist-100">
              {alert.title}
            </h3>
            <p className="font-mono text-[10px] text-mist-400">{alert.id}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-[var(--line)] px-2 py-1 text-xs text-mist-300"
          >
            Close
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <section>
            <h4 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-mist-400">
              Summary
            </h4>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <Row k="Risk" v={fmtNum(alert.risk_score, 0)} />
              <Row k="Source" v={alert.source} />
              <Row k="Category" v={alert.category} />
              <Row
                k="Created"
                v={new Date(alert.created_at).toLocaleString()}
              />
              <Row k="Entity" v={alert.affected_entity} />
              <Row k="Assignee" v={alert.assigned_to ?? "—"} />
            </dl>
          </section>

          <section>
            <h4 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-mist-400">
              Why this alert exists
            </h4>
            <p className="text-sm leading-relaxed text-mist-200">
              {alert.reason}
            </p>
            {alert.evidence && (
              <ul className="mt-2 space-y-1 font-mono text-[11px] text-mist-300">
                {alert.evidence.threshold != null && (
                  <li>
                    Value {fmtNum(alert.evidence.value, 2)} vs threshold{" "}
                    {fmtNum(alert.evidence.threshold, 2)}
                  </li>
                )}
                {alert.evidence.percentage_deviation != null && (
                  <li>
                    Deviation {fmtNum(alert.evidence.percentage_deviation, 1)}%
                    from baseline
                  </li>
                )}
                {alert.evidence.z_score != null && (
                  <li>Z-score {fmtNum(alert.evidence.z_score, 2)}</li>
                )}
                {alert.evidence.persistence_ms != null &&
                  alert.evidence.persistence_ms > 0 && (
                    <li>
                      Elevated for{" "}
                      {Math.round(alert.evidence.persistence_ms / 1000)}s
                    </li>
                  )}
                {alert.evidence.detection_level != null && (
                  <li>Detection L{alert.evidence.detection_level}</li>
                )}
              </ul>
            )}
          </section>

          <section>
            <h4 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-mist-400">
              Evidence
            </h4>
            {alert.evidence ? (
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <Row k="Metric" v={alert.evidence.metric} />
                <Row k="Value" v={fmtNum(alert.evidence.value, 3)} />
                <Row
                  k="Threshold"
                  v={
                    alert.evidence.threshold == null
                      ? "—"
                      : fmtNum(alert.evidence.threshold, 3)
                  }
                />
                <Row
                  k="Baseline"
                  v={
                    alert.evidence.baseline == null
                      ? "—"
                      : fmtNum(alert.evidence.baseline, 3)
                  }
                />
                <Row
                  k="Event ID"
                  v={alert.evidence.event_id?.slice(0, 13) ?? "—"}
                />
                <Row
                  k="Location"
                  v={`${alert.evidence.region}/${alert.evidence.service}`}
                />
              </dl>
            ) : (
              <p className="text-xs text-mist-400">No structured evidence</p>
            )}
          </section>

          <section>
            <h4 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-mist-400">
              Related events
            </h4>
            {relatedEvents.length === 0 ? (
              <p className="text-xs text-mist-400">
                No matching recent stream events in local window
              </p>
            ) : (
              <ul className="space-y-1 font-mono text-[11px] text-mist-300">
                {relatedEvents.map((e) => (
                  <li key={e.event_id}>
                    {new Date(e.server_timestamp).toLocaleTimeString()} ·{" "}
                    {e.metric}={fmtNum(e.value, 2)}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h4 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-mist-400">
              Related incident
            </h4>
            {incident ? (
              <div className="rounded border border-[var(--line)] px-3 py-2 text-xs">
                <div className="font-medium text-mist-100">{incident.title}</div>
                <div className="mt-1 font-mono text-[10px] text-mist-400">
                  {incident.id.slice(0, 8)}… · {incident.status} · risk{" "}
                  {fmtNum(incident.risk_score, 0)} ·{" "}
                  {incident.related_alerts.length} alerts
                </div>
              </div>
            ) : (
              <p className="text-xs text-mist-400">Not linked to an incident</p>
            )}
          </section>

          <section>
            <h4 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-mist-400">
              Lifecycle
            </h4>
            <ol className="flex flex-wrap items-center gap-2 text-xs">
              {LIFECYCLE.map((step, idx) => {
                const on =
                  step === "CREATED" ||
                  reached.has(step) ||
                  (step === "ACKNOWLEDGED" && !!alert.acknowledged_at) ||
                  (step === "ESCALATED" && alert.status === "ESCALATED") ||
                  (step === "RESOLVED" && alert.status === "RESOLVED");
                return (
                  <li key={step} className="flex items-center gap-2">
                    {idx > 0 && (
                      <span className="text-mist-600" aria-hidden>
                        →
                      </span>
                    )}
                    <span
                      className={`rounded border px-2 py-0.5 font-mono text-[10px] ${
                        on
                          ? "border-signal-accent/40 text-signal-accent"
                          : "border-[var(--line)] text-mist-500"
                      }`}
                    >
                      {step}
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>

          <section>
            <h4 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-mist-400">
              Operator actions / audit
            </h4>
            <ul className="space-y-2">
              {alert.history.map((h, i) => (
                <li
                  key={`${h.at}-${h.action}-${i}`}
                  className="border-l border-[var(--line)] pl-3 text-xs"
                >
                  <div className="font-mono text-[10px] text-mist-400">
                    {new Date(h.at).toLocaleString()} · {h.actor}
                  </div>
                  <div className="text-mist-200">
                    {h.action}
                    {h.note ? ` — ${h.note}` : ""}
                  </div>
                </li>
              ))}
              {alertAudit.map((a) => (
                <li
                  key={a.id}
                  className="border-l border-signal-accent/20 pl-3 text-xs text-mist-400"
                >
                  {a.action} @ {new Date(a.timestamp).toLocaleTimeString()}
                </li>
              ))}
            </ul>
          </section>

          {alert.status !== "RESOLVED" && (
            <section className="space-y-3 rounded border border-[var(--line)] p-3">
              <h4 className="font-mono text-[10px] uppercase tracking-wider text-mist-400">
                Actions
              </h4>
              {alert.status === "ACTIVE" && (
                <button
                  type="button"
                  disabled={busy}
                  className="w-full rounded border border-[var(--line)] px-3 py-2 text-xs text-mist-100 hover:bg-white/5 disabled:opacity-50"
                  onClick={() => void run(() => onAcknowledge(alert.id))}
                >
                  Acknowledge
                </button>
              )}
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded border border-[var(--line)] bg-ink-850 px-2 py-1.5 text-xs text-mist-100"
                  placeholder="Assignee"
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                />
                <button
                  type="button"
                  disabled={busy || !assignee.trim()}
                  className="rounded border border-signal-accent/40 px-3 py-1.5 text-xs text-signal-accent disabled:opacity-50"
                  onClick={() =>
                    void run(() => onAssign(alert.id, assignee.trim()))
                  }
                >
                  Assign
                </button>
                {alert.assigned_to && (
                  <button
                    type="button"
                    disabled={busy}
                    className="rounded border border-[var(--line)] px-3 py-1.5 text-xs text-mist-300"
                    onClick={() => void run(() => onUnassign(alert.id))}
                  >
                    Unassign
                  </button>
                )}
              </div>
              {(alert.status === "ACTIVE" ||
                alert.status === "ACKNOWLEDGED") && (
                <div className="space-y-2">
                  <input
                    className="w-full rounded border border-[var(--line)] bg-ink-850 px-2 py-1.5 text-xs text-mist-100"
                    value={escReason}
                    onChange={(e) => setEscReason(e.target.value)}
                    placeholder="Escalation reason"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    className="w-full rounded border border-signal-warn/40 px-3 py-2 text-xs text-signal-warn disabled:opacity-50"
                    onClick={() =>
                      void run(() => onEscalate(alert.id, escReason))
                    }
                  >
                    Escalate
                  </button>
                </div>
              )}
              <button
                type="button"
                disabled={busy}
                className="w-full rounded border border-signal-live/40 px-3 py-2 text-xs text-signal-live disabled:opacity-50"
                onClick={() => void run(() => onResolve(alert.id))}
              >
                Resolve
              </button>
              {error && (
                <p className="text-xs text-signal-crit" role="alert">
                  {error}
                </p>
              )}
            </section>
          )}
        </div>
      </aside>
    </div>
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
