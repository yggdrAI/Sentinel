import { useMemo, useState } from "react";
import type {
  Alert,
  AlertStatus,
  AuditEvent,
  Incident,
  Severity,
  StreamEvent,
} from "@sentinel/shared";
import { SeverityBadge } from "./SeverityBadge";
import { AlertDetailDrawer } from "./AlertDetailDrawer";
import { fmtNum } from "../lib/format";

type SortKey =
  | "newest"
  | "oldest"
  | "severity"
  | "risk"
  | "updated";

type Props = {
  alerts: Alert[];
  incidents: Incident[];
  audit: AuditEvent[];
  events: StreamEvent[];
  onAcknowledge: (id: string) => Promise<void>;
  onAssign: (id: string, assignee: string) => Promise<void>;
  onUnassign: (id: string) => Promise<void>;
  onEscalate: (id: string, reason: string) => Promise<void>;
  onResolve: (id: string) => Promise<void>;
};

const SEVERITIES: Array<Severity | "ALL"> = [
  "ALL",
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
  "INFO",
];

const STATUSES: Array<AlertStatus | "ALL"> = [
  "ALL",
  "ACTIVE",
  "ACKNOWLEDGED",
  "ESCALATED",
  "RESOLVED",
];

const SEV_RANK: Record<string, number> = {
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  INFO: 1,
};

export function AlertCenter({
  alerts,
  incidents,
  audit,
  events,
  onAcknowledge,
  onAssign,
  onUnassign,
  onEscalate,
  onResolve,
}: Props) {
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>("ALL");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("ALL");
  const [category, setCategory] = useState("ALL");
  const [source, setSource] = useState("ALL");
  const [assignee, setAssignee] = useState("ALL");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const categories = useMemo(
    () => ["ALL", ...Array.from(new Set(alerts.map((a) => a.category)))],
    [alerts]
  );
  const sources = useMemo(
    () => ["ALL", ...Array.from(new Set(alerts.map((a) => a.source)))],
    [alerts]
  );
  const assignees = useMemo(
    () => [
      "ALL",
      ...Array.from(
        new Set(alerts.map((a) => a.assigned_to).filter(Boolean) as string[])
      ),
    ],
    [alerts]
  );

  const counts = useMemo(() => {
    const today = new Date().toDateString();
    return {
      active: alerts.filter(
        (a) => a.status === "ACTIVE" || a.status === "ESCALATED"
      ).length,
      critical: alerts.filter(
        (a) => a.severity === "CRITICAL" && a.status !== "RESOLVED"
      ).length,
      high: alerts.filter(
        (a) => a.severity === "HIGH" && a.status !== "RESOLVED"
      ).length,
      acknowledged: alerts.filter((a) => a.status === "ACKNOWLEDGED").length,
      escalated: alerts.filter((a) => a.status === "ESCALATED").length,
      resolvedToday: alerts.filter(
        (a) =>
          a.status === "RESOLVED" &&
          a.resolved_at &&
          new Date(a.resolved_at).toDateString() === today
      ).length,
    };
  }, [alerts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = alerts.filter((a) => {
      if (severity !== "ALL" && a.severity !== severity) return false;
      if (status !== "ALL" && a.status !== status) return false;
      if (category !== "ALL" && a.category !== category) return false;
      if (source !== "ALL" && a.source !== source) return false;
      if (assignee !== "ALL" && a.assigned_to !== assignee) return false;
      if (q) {
        const hay = [
          a.id,
          a.title,
          a.reason,
          a.affected_entity,
          a.region,
          a.service,
          a.metric,
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    list = [...list].sort((a, b) => {
      switch (sort) {
        case "oldest":
          return (
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
        case "severity":
          return (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0);
        case "risk":
          return b.risk_score - a.risk_score;
        case "updated":
          return (
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
          );
        case "newest":
        default:
          return (
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
      }
    });
    return list;
  }, [alerts, severity, status, category, source, assignee, query, sort]);

  const selected = alerts.find((a) => a.id === selectedId) ?? null;

  async function run(id: string, fn: () => Promise<void>) {
    setBusyId(id);
    try {
      await fn();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold tracking-wide text-mist-100">
            Alert Center
          </h2>
          <p className="text-xs text-mist-400">
            Operational workflow — acknowledge, assign, escalate, resolve
          </p>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--line)] sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Active" value={counts.active} />
        <Stat label="Critical" value={counts.critical} tone="crit" />
        <Stat label="High" value={counts.high} tone="warn" />
        <Stat label="Acknowledged" value={counts.acknowledged} />
        <Stat label="Escalated" value={counts.escalated} tone="warn" />
        <Stat label="Resolved today" value={counts.resolvedToday} />
      </div>

      <div className="flex flex-wrap gap-3 rounded-lg border border-[var(--line)] bg-ink-900 p-4">
        <Filter label="Severity" value={severity} options={SEVERITIES} onChange={setSeverity} />
        <Filter label="Status" value={status} options={STATUSES} onChange={setStatus} />
        <Filter label="Category" value={category} options={categories} onChange={setCategory} />
        <Filter label="Source" value={source} options={sources} onChange={setSource} />
        <Filter label="Assignee" value={assignee} options={assignees} onChange={setAssignee} />
        <label className="text-xs text-mist-400">
          Sort
          <select
            className="mt-1 block rounded border border-[var(--line)] bg-ink-850 px-2 py-1.5 text-mist-100"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="severity">Highest severity</option>
            <option value="risk">Highest risk</option>
            <option value="updated">Recently updated</option>
          </select>
        </label>
        <label className="min-w-[200px] flex-1 text-xs text-mist-400">
          Search
          <input
            className="mt-1 block w-full rounded border border-[var(--line)] bg-ink-850 px-2 py-1.5 text-mist-100"
            placeholder="ID, title, entity, region…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="ml-auto self-end font-mono text-xs text-mist-400">
          {filtered.length} shown
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--line)] bg-ink-900">
        {filtered.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-mist-400">
            No alerts match the current filters
          </p>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {filtered.map((a) => {
              const incident = incidents.find(
                (i) =>
                  i.id === a.related_incident_id ||
                  i.alert_ids.includes(a.id)
              );
              return (
                <li
                  key={a.id}
                  className={`px-4 py-3 transition hover:bg-white/[0.03] ${
                    a.severity === "CRITICAL" && a.status !== "RESOLVED"
                      ? "border-l-2 border-l-signal-crit"
                      : ""
                  }`}
                >
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <SeverityBadge severity={a.severity} />
                        <span className="font-mono text-[10px] uppercase text-mist-400">
                          {a.status}
                        </span>
                        {a.escalation_level > 0 && (
                          <span className="font-mono text-[10px] text-signal-warn">
                            L{a.escalation_level}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="mt-1 text-left text-sm font-medium text-mist-100 hover:text-signal-accent"
                        onClick={() => setSelectedId(a.id)}
                      >
                        {a.title}
                      </button>
                      <p className="mt-1 line-clamp-2 text-xs text-mist-300">
                        {a.reason}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-mist-400">
                        <span>risk {fmtNum(a.risk_score, 0)}</span>
                        <span>{a.affected_entity}</span>
                        <span>{a.source}</span>
                        <span>
                          {new Date(a.created_at).toLocaleString()}
                        </span>
                        <span>{a.assigned_to ?? "Unassigned"}</span>
                        {incident && (
                          <span className="text-signal-accent">
                            incident {incident.id.slice(0, 8)}…
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <ActionBtn
                        label="Open"
                        onClick={() => setSelectedId(a.id)}
                      />
                      {a.status === "ACTIVE" && (
                        <ActionBtn
                          label="Ack"
                          disabled={busyId === a.id}
                          onClick={() =>
                            void run(a.id, () => onAcknowledge(a.id))
                          }
                        />
                      )}
                      {(a.status === "ACTIVE" ||
                        a.status === "ACKNOWLEDGED") && (
                        <ActionBtn
                          label="Escalate"
                          disabled={busyId === a.id}
                          tone="warn"
                          onClick={() =>
                            void run(a.id, () =>
                              onEscalate(a.id, "Escalated from Alert Center")
                            )
                          }
                        />
                      )}
                      {a.status !== "RESOLVED" && (
                        <ActionBtn
                          label="Resolve"
                          disabled={busyId === a.id}
                          tone="ok"
                          onClick={() =>
                            void run(a.id, () => onResolve(a.id))
                          }
                        />
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {selected && (
        <AlertDetailDrawer
          alert={selected}
          incidents={incidents}
          audit={audit}
          events={events}
          onClose={() => setSelectedId(null)}
          onAcknowledge={onAcknowledge}
          onAssign={onAssign}
          onUnassign={onUnassign}
          onEscalate={onEscalate}
          onResolve={onResolve}
        />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "crit" | "warn";
}) {
  return (
    <div className="bg-ink-900 px-3 py-2.5">
      <div className="font-mono text-[10px] uppercase tracking-wider text-mist-400">
        {label}
      </div>
      <div
        className={`mt-0.5 font-mono text-xl tabular-nums ${
          tone === "crit"
            ? "text-signal-crit"
            : tone === "warn"
              ? "text-signal-warn"
              : "text-mist-100"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function Filter<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[] | T[];
  onChange: (v: T) => void;
}) {
  return (
    <label className="text-xs text-mist-400">
      {label}
      <select
        className="mt-1 block rounded border border-[var(--line)] bg-ink-850 px-2 py-1.5 text-mist-100"
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function ActionBtn({
  label,
  onClick,
  disabled,
  tone,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "ok" | "warn";
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded border px-2 py-1 text-[10px] uppercase tracking-wide disabled:opacity-40 ${
        tone === "ok"
          ? "border-signal-live/40 text-signal-live"
          : tone === "warn"
            ? "border-signal-warn/40 text-signal-warn"
            : "border-[var(--line)] text-mist-200 hover:bg-white/5"
      }`}
    >
      {label}
    </button>
  );
}
