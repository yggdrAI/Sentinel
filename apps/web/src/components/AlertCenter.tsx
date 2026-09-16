import { useMemo, useState } from "react";
import type { Alert, Severity } from "@sentinel/shared";
import { AlertPanel } from "./AlertPanel";

const SEVERITIES: Array<Severity | "ALL"> = [
  "ALL",
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
  "INFO",
];

type Props = {
  alerts: Alert[];
  onAcknowledge: (id: string) => Promise<void>;
  onResolve: (id: string) => Promise<void>;
};

export function AlertCenter({ alerts, onAcknowledge, onResolve }: Props) {
  const [severity, setSeverity] = useState<(typeof SEVERITIES)[number]>("ALL");
  const [region, setRegion] = useState("ALL");
  const [metric, setMetric] = useState("ALL");
  const [status, setStatus] = useState<
    "ALL" | "ACTIVE" | "ACKNOWLEDGED" | "RESOLVED"
  >("ALL");

  const regions = useMemo(
    () => ["ALL", ...Array.from(new Set(alerts.map((a) => a.region)))],
    [alerts]
  );
  const metrics = useMemo(
    () => ["ALL", ...Array.from(new Set(alerts.map((a) => a.metric)))],
    [alerts]
  );

  const filtered = alerts.filter((a) => {
    if (severity !== "ALL" && a.severity !== severity) return false;
    if (region !== "ALL" && a.region !== region) return false;
    if (metric !== "ALL" && a.metric !== metric) return false;
    if (status !== "ALL" && a.status !== status) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 rounded-lg border border-[var(--line)] bg-ink-900 p-4">
        <Filter label="Severity" value={severity} options={SEVERITIES} onChange={setSeverity} />
        <Filter label="Region" value={region} options={regions} onChange={setRegion} />
        <Filter label="Metric" value={metric} options={metrics} onChange={setMetric} />
        <Filter
          label="Status"
          value={status}
          options={["ALL", "ACTIVE", "ACKNOWLEDGED", "RESOLVED"]}
          onChange={(v) => setStatus(v as typeof status)}
        />
        <div className="ml-auto self-end font-mono text-xs text-mist-400">
          {filtered.length} alerts
        </div>
      </div>
      <div className="h-[640px]">
        <AlertPanel
          alerts={filtered}
          onAcknowledge={onAcknowledge}
          onResolve={onResolve}
        />
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
