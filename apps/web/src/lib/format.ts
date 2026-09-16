export function severityColor(severity: string): string {
  switch (severity) {
    case "CRITICAL":
      return "text-signal-crit";
    case "HIGH":
      return "text-orange-400";
    case "MEDIUM":
      return "text-signal-warn";
    case "LOW":
      return "text-signal-info";
    default:
      return "text-mist-300";
  }
}

export function severityBg(severity: string): string {
  switch (severity) {
    case "CRITICAL":
      return "bg-signal-crit/15 border-signal-crit/40";
    case "HIGH":
      return "bg-orange-500/15 border-orange-400/40";
    case "MEDIUM":
      return "bg-signal-warn/15 border-signal-warn/40";
    case "LOW":
      return "bg-signal-info/15 border-signal-info/40";
    default:
      return "bg-white/5 border-white/10";
  }
}

export function statusColor(status: string): string {
  switch (status) {
    case "HEALTHY":
    case "NORMAL":
      return "text-signal-live";
    case "DEGRADED":
    case "WARNING":
    case "RECOVERING":
      return "text-signal-warn";
    case "CRITICAL":
    case "SLA BREACHED":
    case "FAILED":
    case "DISCONNECTED":
      return "text-signal-crit";
    default:
      return "text-mist-300";
  }
}

export function formatAge(seconds: number): string {
  if (seconds >= 9999) return "—";
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
}

export function fmtNum(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return n.toFixed(digits);
}
