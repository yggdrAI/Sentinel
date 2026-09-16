import type { AiAdvisory, Incident, Alert, MetricSnapshot } from "@sentinel/shared";

/**
 * Deterministic advisory layer — rule-based summaries, clearly labeled advisory.
 * Not used for detection; detection remains statistical/threshold-based.
 */
export function generateAdvisory(
  incident: Incident | null,
  alerts: Alert[],
  snapshot: MetricSnapshot
): AiAdvisory {
  const active = alerts.filter((a) => a.status === "ACTIVE");
  const top = incident ?? null;

  if (!top && active.length === 0) {
    return {
      incident_id: null,
      summary:
        "Operations are within expected bounds. No active incidents requiring operator intervention.",
      root_cause_hypotheses: [
        "Traffic mix is stable relative to the rolling baseline.",
        "Regional distribution shows no sustained concentration.",
      ],
      investigation_steps: [
        "Continue monitoring freshness SLA and event rate.",
        "Review Demo Mode controls only if validating failure handling.",
      ],
      executive_summary:
        "System healthy. Live KPIs updating within freshness SLA. No critical anomalies detected.",
      advisory: true,
      generated_at: new Date().toISOString(),
    };
  }

  const alert =
    active[0] ??
    alerts.find((a) => top && a.id === top.alert_ids[0]) ??
    alerts[0];

  const focus = top ?? {
    id: alert?.id ?? "unknown",
    region: alert?.region ?? "unknown",
    service: alert?.service ?? "unknown",
    metric: alert?.metric ?? "unknown",
    risk_score: alert?.risk_score ?? 0,
    duration_seconds: 0,
    title: alert?.reason ?? "Elevated operational signal",
  };

  const pct = Math.abs(snapshot.percentage_deviation).toFixed(0);
  const reasonText = alert?.reason ?? top?.title ?? "Elevated signal detected.";
  const summary = `${capitalize(String(focus.metric).replace(/_/g, " "))} elevated in ${focus.region} region (${focus.service}). Value is approximately ${pct}% from the rolling baseline. ${reasonText}`;

  const hypotheses: string[] = [];
  if (focus.service === "payments") {
    hypotheses.push("Payment gateway degradation or upstream timeout amplification.");
    hypotheses.push("Regional routing imbalance concentrating failures in one zone.");
  }
  if (focus.metric.includes("latency")) {
    hypotheses.push("Downstream dependency latency or connection pool saturation.");
  }
  if (focus.metric.includes("failure") || focus.metric.includes("error")) {
    hypotheses.push("Recent deployment or configuration change affecting error paths.");
  }
  hypotheses.push("Transient traffic spike exceeding capacity envelopes.");

  const steps = [
    `Check ${focus.service} health endpoints in ${focus.region}.`,
    `Compare regional ${focus.metric.replace(/_/g, " ")} against peer regions.`,
    "Inspect recent deployment or change activity for the affected service.",
    "Validate upstream dependency SLAs and error budgets.",
  ];

  const executive = `Advisory: ${focus.region}/${focus.service} shows elevated ${focus.metric.replace(/_/g, " ")} (risk ${focus.risk_score}/100). Recommend investigating gateway health and regional capacity. This summary is advisory and does not trigger automated remediation.`;

  return {
    incident_id: top?.id ?? null,
    summary,
    root_cause_hypotheses: hypotheses.slice(0, 4),
    investigation_steps: steps,
    executive_summary: executive,
    advisory: true,
    generated_at: new Date().toISOString(),
  };
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
