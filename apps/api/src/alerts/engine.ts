import { randomUUID } from "node:crypto";
import type {
  Alert,
  AlertEvidence,
  AlertHistoryEntry,
  AlertStatus,
  AuditAction,
  AuditEvent,
  Incident,
  Severity,
  StreamEvent,
  RiskScore,
} from "@sentinel/shared";
import type { AnomalyResult } from "../anomaly/detector.js";
import { logger } from "../logger.js";
import { EventEmitter } from "node:events";

const DEFAULT_ACTOR = "operator";

export class AlertEngine extends EventEmitter {
  private alerts: Alert[] = [];
  private incidents: Incident[] = [];
  private auditLog: AuditEvent[] = [];
  private readonly cooldown = new Map<string, number>();
  private readonly COOLDOWN_MS = 12_000;

  getAlerts(filter?: {
    severity?: Severity;
    region?: string;
    metric?: string;
    status?: AlertStatus;
    assigned_to?: string;
    source?: string;
    category?: string;
  }): Alert[] {
    return this.alerts.filter((a) => {
      if (filter?.severity && a.severity !== filter.severity) return false;
      if (filter?.region && a.region !== filter.region) return false;
      if (filter?.metric && a.metric !== filter.metric) return false;
      if (filter?.status && a.status !== filter.status) return false;
      if (filter?.assigned_to && a.assigned_to !== filter.assigned_to)
        return false;
      if (filter?.source && a.source !== filter.source) return false;
      if (filter?.category && a.category !== filter.category) return false;
      return true;
    });
  }

  getAlert(id: string): Alert | undefined {
    return this.alerts.find((a) => a.id === id);
  }

  getIncidents(): Incident[] {
    return [...this.incidents];
  }

  getIncident(id: string): Incident | undefined {
    return this.incidents.find((i) => i.id === id || i.incident_id === id);
  }

  getAudit(limit = 200): AuditEvent[] {
    return this.auditLog.slice(0, limit);
  }

  getActiveAlertCount(): number {
    return this.alerts.filter(
      (a) => a.status === "ACTIVE" || a.status === "ESCALATED"
    ).length;
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

    const now = new Date().toISOString();
    const evidence: AlertEvidence = {
      metric: event.metric,
      value: event.value,
      threshold: anomaly.threshold,
      baseline: event.baseline_value,
      z_score: anomaly.z_score,
      percentage_deviation: anomaly.percentage_deviation,
      persistence_ms: anomaly.persistence_ms,
      detection_level: anomaly.level,
      event_id: event.event_id,
      region: event.region,
      service: event.service,
    };

    const alert = this.buildAlert({
      now,
      severity: anomaly.severity,
      metric: event.metric,
      region: event.region,
      service: event.service,
      value: event.value,
      threshold: anomaly.threshold,
      baseline: event.baseline_value,
      reason: anomaly.reason,
      source: "anomaly-engine",
      risk_score: risk.risk_score,
      evidence,
      category: event.metric,
    });

    this.alerts.unshift(alert);
    if (this.alerts.length > 500) this.alerts.length = 500;

    this.recordAudit("ALERT_CREATED", "system", "alert", alert.id, {
      severity: alert.severity,
      metric: alert.metric,
    });
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
    const now = new Date().toISOString();
    const alert = this.buildAlert({
      now,
      severity,
      metric: "data_freshness",
      region: "system",
      service: "pipeline",
      value: 0,
      threshold: null,
      baseline: null,
      reason,
      source: "freshness-monitor",
      risk_score: severity === "CRITICAL" ? 95 : 70,
      evidence: {
        metric: "data_freshness",
        value: 0,
        threshold: null,
        baseline: null,
        z_score: null,
        percentage_deviation: null,
        persistence_ms: null,
        detection_level: null,
        event_id: null,
        region: "system",
        service: "pipeline",
      },
      category: "pipeline",
    });
    this.alerts.unshift(alert);
    this.recordAudit("ALERT_CREATED", "system", "alert", alert.id, {
      severity,
      reason,
    });
    logger.warn("system_alert_created", { id: alert.id, reason });
    this.emit("alert", alert);
    return alert;
  }

  acknowledge(id: string, actor = DEFAULT_ACTOR): Alert | null {
    const alert = this.alerts.find((a) => a.id === id);
    if (!alert) return null;
    if (alert.status !== "ACTIVE") return null;

    const now = new Date().toISOString();
    alert.status = "ACKNOWLEDGED";
    alert.acknowledged_at = now;
    alert.acknowledged_by = actor;
    alert.updated_at = now;
    this.pushHistory(alert, {
      at: now,
      action: "ACKNOWLEDGED",
      actor,
    });
    this.recordAudit("ALERT_ACKNOWLEDGED", actor, "alert", id);
    logger.info("alert_acknowledged", { id, actor });
    this.emit("alert", alert);

    for (const inc of this.incidents) {
      if (inc.status === "ACTIVE" && inc.alert_ids.includes(id)) {
        inc.status = "ACKNOWLEDGED";
        inc.acknowledged_at = now;
        this.recordAudit("INCIDENT_UPDATED", actor, "incident", inc.id, {
          status: "ACKNOWLEDGED",
        });
        this.emit("incident", inc);
      }
    }
    return alert;
  }

  assign(
    id: string,
    assignee: string,
    actor = DEFAULT_ACTOR
  ): Alert | null {
    const alert = this.alerts.find((a) => a.id === id);
    if (!alert || alert.status === "RESOLVED") return null;
    const name = assignee.trim();
    if (!name) return null;

    const now = new Date().toISOString();
    alert.assigned_to = name;
    alert.updated_at = now;
    this.pushHistory(alert, {
      at: now,
      action: "ASSIGNED",
      actor,
      note: `Assigned to ${name}`,
    });
    this.recordAudit("ALERT_ASSIGNED", actor, "alert", id, {
      assigned_to: name,
    });
    this.emit("alert", alert);
    return alert;
  }

  unassign(id: string, actor = DEFAULT_ACTOR): Alert | null {
    const alert = this.alerts.find((a) => a.id === id);
    if (!alert || alert.status === "RESOLVED") return null;
    if (!alert.assigned_to) return null;

    const now = new Date().toISOString();
    const prev = alert.assigned_to;
    alert.assigned_to = null;
    alert.updated_at = now;
    this.pushHistory(alert, {
      at: now,
      action: "UNASSIGNED",
      actor,
      note: `Unassigned from ${prev}`,
    });
    this.recordAudit("ALERT_UNASSIGNED", actor, "alert", id, {
      previous: prev,
    });
    this.emit("alert", alert);
    return alert;
  }

  escalate(
    id: string,
    reason: string,
    actor = DEFAULT_ACTOR
  ): Alert | null {
    const alert = this.alerts.find((a) => a.id === id);
    if (!alert) return null;
    if (alert.status !== "ACTIVE" && alert.status !== "ACKNOWLEDGED") {
      return null;
    }
    const note = reason.trim() || "Operator escalation";
    const now = new Date().toISOString();
    alert.status = "ESCALATED";
    alert.escalation_level = Math.max(1, alert.escalation_level + 1);
    alert.escalated_at = now;
    alert.escalated_by = actor;
    alert.escalation_reason = note;
    alert.updated_at = now;
    if (!alert.acknowledged_at) {
      alert.acknowledged_at = now;
      alert.acknowledged_by = actor;
    }
    this.pushHistory(alert, {
      at: now,
      action: "ESCALATED",
      actor,
      note,
    });
    this.recordAudit("ALERT_ESCALATED", actor, "alert", id, {
      level: alert.escalation_level,
      reason: note,
    });
    logger.info("alert_escalated", { id, level: alert.escalation_level });
    this.emit("alert", alert);

    // Escalation ensures an incident exists / is elevated
    this.upsertIncident(alert, true);
    return alert;
  }

  resolve(id: string, actor = DEFAULT_ACTOR): Alert | null {
    const alert = this.alerts.find((a) => a.id === id);
    if (!alert || alert.status === "RESOLVED") return null;

    const now = new Date().toISOString();
    alert.status = "RESOLVED";
    alert.resolved_at = now;
    alert.resolved_by = actor;
    alert.updated_at = now;
    if (!alert.acknowledged_at) {
      alert.acknowledged_at = now;
      alert.acknowledged_by = actor;
    }
    this.pushHistory(alert, {
      at: now,
      action: "RESOLVED",
      actor,
    });
    this.recordAudit("ALERT_RESOLVED", actor, "alert", id);
    logger.info("alert_resolved", { id, actor });
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
        inc.resolved_at = now;
        this.recordAudit("INCIDENT_RESOLVED", actor, "incident", inc.id);
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
    this.recordAudit("INCIDENT_UPDATED", DEFAULT_ACTOR, "incident", inc.id, {
      status: "ACKNOWLEDGED",
    });
    this.emit("incident", inc);
    return inc;
  }

  private buildAlert(input: {
    now: string;
    severity: Severity;
    metric: string;
    region: string;
    service: string;
    value: number;
    threshold: number | null;
    baseline: number | null;
    reason: string;
    source: string;
    risk_score: number;
    evidence: AlertEvidence | null;
    category: string;
  }): Alert {
    const title =
      input.metric === "data_freshness"
        ? "Data freshness SLA"
        : `${label(input.metric)} — ${input.region}/${input.service}`;

    return {
      id: randomUUID(),
      title,
      category: input.category,
      created_at: input.now,
      updated_at: input.now,
      acknowledged_at: null,
      escalated_at: null,
      resolved_at: null,
      acknowledged_by: null,
      escalated_by: null,
      resolved_by: null,
      assigned_to: null,
      escalation_level: 0,
      escalation_reason: null,
      severity: input.severity,
      status: "ACTIVE",
      metric: input.metric,
      region: input.region,
      service: input.service,
      value: input.value,
      threshold: input.threshold,
      baseline: input.baseline,
      reason: input.reason,
      source: input.source,
      risk_score: input.risk_score,
      affected_entity: `${input.region}/${input.service}`,
      related_incident_id: null,
      evidence: input.evidence,
      history: [
        {
          at: input.now,
          action: "CREATED",
          actor: "system",
          note: input.reason,
        },
      ],
    };
  }

  private upsertIncident(alert: Alert, fromEscalation = false) {
    const existing = this.incidents.find(
      (i) =>
        i.status !== "RESOLVED" &&
        i.region === alert.region &&
        i.service === alert.service &&
        i.metric === alert.metric
    );
    if (existing) {
      if (!existing.alert_ids.includes(alert.id)) {
        existing.alert_ids.push(alert.id);
      }
      existing.related_alerts = [...existing.alert_ids];
      existing.severity =
        severityRank(alert.severity) > severityRank(existing.severity)
          ? alert.severity
          : existing.severity;
      existing.risk_score = Math.max(existing.risk_score, alert.risk_score);
      existing.duration_seconds = Math.round(
        (Date.now() - new Date(existing.created_at).getTime()) / 1000
      );
      if (fromEscalation && existing.status === "ACTIVE") {
        existing.status = "ACKNOWLEDGED";
        existing.acknowledged_at =
          existing.acknowledged_at ?? new Date().toISOString();
      }
      alert.related_incident_id = existing.id;
      alert.updated_at = new Date().toISOString();
      this.recordAudit("INCIDENT_UPDATED", "system", "incident", existing.id, {
        alert_id: alert.id,
      });
      this.emit("incident", existing);
      this.emit("alert", alert);
      return;
    }

    const id = randomUUID();
    const incident: Incident = {
      id,
      incident_id: id,
      created_at: alert.created_at,
      acknowledged_at: fromEscalation ? new Date().toISOString() : null,
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
      triggering_alert_id: alert.id,
      status: fromEscalation ? "ACKNOWLEDGED" : "ACTIVE",
    };
    this.incidents.unshift(incident);
    alert.related_incident_id = id;
    alert.updated_at = new Date().toISOString();
    this.recordAudit("INCIDENT_CREATED", "system", "incident", id, {
      triggering_alert_id: alert.id,
    });
    logger.info("incident_created", { id: incident.id, title: incident.title });
    this.emit("incident", incident);
    this.emit("alert", alert);
  }

  private pushHistory(alert: Alert, entry: AlertHistoryEntry) {
    alert.history = [...alert.history, entry];
  }

  private recordAudit(
    action: AuditAction,
    actor: string,
    entity_type: "alert" | "incident",
    entity_id: string,
    metadata?: Record<string, unknown>
  ) {
    const event: AuditEvent = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      action,
      actor,
      entity_type,
      entity_id,
      metadata,
    };
    this.auditLog.unshift(event);
    if (this.auditLog.length > 1000) this.auditLog.length = 1000;
    this.emit("audit", event);
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
