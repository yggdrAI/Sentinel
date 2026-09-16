import { randomUUID } from "node:crypto";
import type {
  Alert,
  AlertStatus,
  Incident,
  Severity,
  StreamEvent,
  RiskScore,
} from "@sentinel/shared";
import type { AnomalyResult } from "../anomaly/detector.js";
import { logger } from "../logger.js";
import { EventEmitter } from "node:events";

export class AlertEngine extends EventEmitter {
  private alerts: Alert[] = [];
  private incidents: Incident[] = [];
  private readonly cooldown = new Map<string, number>();
  private readonly COOLDOWN_MS = 12_000;

  getAlerts(filter?: {
    severity?: Severity;
    region?: string;
    metric?: string;
    status?: AlertStatus;
  }): Alert[] {
    return this.alerts.filter((a) => {
      if (filter?.severity && a.severity !== filter.severity) return false;
      if (filter?.region && a.region !== filter.region) return false;
      if (filter?.metric && a.metric !== filter.metric) return false;
      if (filter?.status && a.status !== filter.status) return false;
      return true;
    });
  }

  getIncidents(): Incident[] {
    return [...this.incidents];
  }

  getActiveAlertCount(): number {
    return this.alerts.filter((a) => a.status === "ACTIVE").length;
  }

  getCriticalIncidentCount(): number {
    return this.incidents.filter(
      (i) =>
        i.status !== "RESOLVED" &&
        (i.severity === "CRITICAL" || i.severity === "HIGH")
    ).length;
  }

  maybeCreate(
    event: StreamEvent,
    anomaly: AnomalyResult,
    risk: RiskScore
  ): Alert | null {
    if (!anomaly.isAnomaly) return null;
    if (!anomaly.reason || anomaly.reason.trim().length === 0) return null;
    if (anomaly.severity === "INFO" || anomaly.severity === "LOW") {
      if (risk.score < 45) return null;
    }

    const key = `${event.metric}|${event.region}|${event.service}`;
    const last = this.cooldown.get(key) ?? 0;
    if (Date.now() - last < this.COOLDOWN_MS) return null;
    this.cooldown.set(key, Date.now());

    const alert: Alert = {
      id: randomUUID(),
      created_at: new Date().toISOString(),
      acknowledged_at: null,
      resolved_at: null,
      severity: anomaly.severity,
      status: "ACTIVE",
      metric: event.metric,
      region: event.region,
      service: event.service,
      value: event.value,
      threshold: anomaly.threshold,
      baseline: event.baseline_value,
      reason: anomaly.reason,
      source: "anomaly-engine",
      risk_score: risk.risk_score,
      affected_entity: `${event.region}/${event.service}`,
    };

    this.alerts.unshift(alert);
    if (this.alerts.length > 500) this.alerts.length = 500;

    logger.info("alert_created", {
      id: alert.id,
      severity: alert.severity,
      metric: alert.metric,
      region: alert.region,
    });
    this.emit("alert", alert);

    if (alert.severity === "HIGH" || alert.severity === "CRITICAL") {
      this.upsertIncident(alert);
    }

    return alert;
  }

  createSystemAlert(reason: string, severity: Severity = "CRITICAL"): Alert {
    const alert: Alert = {
      id: randomUUID(),
      created_at: new Date().toISOString(),
      acknowledged_at: null,
      resolved_at: null,
      severity,
      status: "ACTIVE",
      metric: "data_freshness",
      region: "system",
      service: "pipeline",
      value: 0,
      threshold: null,
      baseline: null,
      reason,
      source: "freshness-monitor",
      risk_score: severity === "CRITICAL" ? 95 : 70,
      affected_entity: "data-pipeline",
    };
    this.alerts.unshift(alert);
    logger.warn("system_alert_created", { id: alert.id, reason });
    this.emit("alert", alert);
    return alert;
  }

  acknowledge(id: string): Alert | null {
    const alert = this.alerts.find((a) => a.id === id);
    if (!alert || alert.status !== "ACTIVE") return null;
    alert.status = "ACKNOWLEDGED";
    alert.acknowledged_at = new Date().toISOString();
    logger.info("alert_acknowledged", { id });
    this.emit("alert", alert);

    for (const inc of this.incidents) {
      if (inc.status === "ACTIVE" && inc.alert_ids.includes(id)) {
        inc.status = "ACKNOWLEDGED";
        inc.acknowledged_at = alert.acknowledged_at;
        this.emit("incident", inc);
      }
    }
    return alert;
  }

  resolve(id: string): Alert | null {
    const alert = this.alerts.find((a) => a.id === id);
    if (!alert || alert.status === "RESOLVED") return null;
    alert.status = "RESOLVED";
    alert.resolved_at = new Date().toISOString();
    if (!alert.acknowledged_at) {
      alert.acknowledged_at = alert.resolved_at;
    }
    logger.info("alert_resolved", { id });
    this.emit("alert", alert);

    for (const inc of this.incidents) {
      if (inc.status === "RESOLVED") continue;
      if (!inc.alert_ids.includes(id)) continue;
      const stillOpen = inc.alert_ids.some((aid) => {
        const a = this.alerts.find((x) => x.id === aid);
        return a && a.status !== "RESOLVED";
      });
      if (!stillOpen) {
        inc.status = "RESOLVED";
        inc.resolved_at = new Date().toISOString();
        this.emit("incident", inc);
      }
    }

    return alert;
  }

  acknowledgeIncident(id: string): Incident | null {
    const inc = this.incidents.find((i) => i.id === id || i.incident_id === id);
    if (!inc || inc.status === "RESOLVED") return null;
    inc.status = "ACKNOWLEDGED";
    inc.acknowledged_at = new Date().toISOString();
    this.emit("incident", inc);
    return inc;
  }

  private upsertIncident(alert: Alert) {
    const existing = this.incidents.find(
      (i) =>
        i.status !== "RESOLVED" &&
        i.region === alert.region &&
        i.service === alert.service &&
        i.metric === alert.metric
    );
    if (existing) {
      existing.alert_ids.push(alert.id);
      existing.related_alerts = [...existing.alert_ids];
      existing.severity =
        severityRank(alert.severity) > severityRank(existing.severity)
          ? alert.severity
          : existing.severity;
      existing.risk_score = Math.max(existing.risk_score, alert.risk_score);
      existing.duration_seconds = Math.round(
        (Date.now() - new Date(existing.created_at).getTime()) / 1000
      );
      this.emit("incident", existing);
      return;
    }

    const id = randomUUID();
    const incident: Incident = {
      id,
      incident_id: id,
      created_at: alert.created_at,
      acknowledged_at: null,
      resolved_at: null,
      severity: alert.severity,
      title: `${label(alert.metric)} spike in ${alert.region} (${alert.service})`,
      region: alert.region,
      service: alert.service,
      metric: alert.metric,
      duration_seconds: 0,
      risk_score: alert.risk_score,
      alert_ids: [alert.id],
      related_alerts: [alert.id],
      status: "ACTIVE",
    };
    this.incidents.unshift(incident);
    logger.info("incident_created", { id: incident.id, title: incident.title });
    this.emit("incident", incident);
  }

  tickDurations() {
    for (const inc of this.incidents) {
      if (inc.status !== "RESOLVED") {
        inc.duration_seconds = Math.round(
          (Date.now() - new Date(inc.created_at).getTime()) / 1000
        );
      }
    }
  }
}

function severityRank(s: Severity): number {
  return { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 }[s];
}

function label(m: string) {
  return m.replace(/_/g, " ");
}
