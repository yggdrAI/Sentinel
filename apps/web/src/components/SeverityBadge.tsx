import type { Severity } from "@sentinel/shared";
import { severityBg, severityColor } from "../lib/format";

const ICONS: Record<Severity, string> = {
  INFO: "i",
  LOW: "!",
  MEDIUM: "!!",
  HIGH: "▲",
  CRITICAL: "●",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide ${severityBg(severity)} ${severityColor(severity)}`}
      role="status"
      aria-label={`Severity ${severity}`}
    >
      <span aria-hidden="true">{ICONS[severity]}</span>
      {severity}
    </span>
  );
}
