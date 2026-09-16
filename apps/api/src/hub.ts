import { EventEmitter } from "node:events";
import {
  REGIONS,
  type DemoCommand,
  type KpiSnapshot,
  type RegionState,
  type RiskScore,
  type SimulationMode,
  type StreamEvent,
  type WsMessage,
} from "@sentinel/shared";
import { StreamSimulator } from "./stream/simulator.js";
import { ProcessingEngine } from "./processing/engine.js";
import { AnomalyDetector } from "./anomaly/detector.js";
import { computeRiskScore } from "./anomaly/risk.js";
import { AlertEngine } from "./alerts/engine.js";
import { FreshnessMonitor } from "./health/freshness.js";
import { generateAdvisory } from "./ai/advisory.js";
import { forecastBreach } from "./processing/predict.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

/**
 * Central orchestrator wiring simulator → processing → detection → broadcast.
 */
export class SentinelHub extends EventEmitter {
  readonly simulator = new StreamSimulator();
  readonly processor = new ProcessingEngine();
  readonly detector = new AnomalyDetector();
  readonly alerts = new AlertEngine();
  readonly freshness = new FreshnessMonitor();

  private lastRisk: RiskScore = {
    score: 0,
    risk_score: 0,
    contributors: [],
    severity: "INFO",
    timestamp: new Date().toISOString(),
  };
  private regionAgg = new Map<
    string,
    { value: number; baseline: number; alerts: number }
  >();
  private broadcastTimer: NodeJS.Timeout | null = null;
  private processedInSecond = 0;
  private lastProcessingRate = 0;
  private rateTimer: NodeJS.Timeout | null = null;
  private lastSlaAlertAt = 0;

  start() {
    this.freshness.start();
    this.freshness.setIngestionStatus("RUNNING");
    this.simulator.start("NORMAL");

    this.simulator.on("event", (event: StreamEvent) => this.onEvent(event));
    this.simulator.on("mode", (mode: SimulationMode) => {
      this.emit("message", {
        type: "mode",
        payload: { mode },
      } satisfies WsMessage);
      this.freshness.setIngestionStatus(
        mode === "PIPELINE_FAILURE" ? "FAILED" : "RUNNING"
      );
    });
    this.simulator.on("recovered", () => {
      this.freshness.setIngestionStatus("RECOVERING");
      setTimeout(() => this.freshness.setIngestionStatus("RUNNING"), 1500);
    });

    this.freshness.on("freshness", (f) => {
      this.emit("message", { type: "freshness", payload: f } satisfies WsMessage);
    });
    this.freshness.on("sla_breach", (f) => {
      if (Date.now() - this.lastSlaAlertAt < 15_000) return;
      this.lastSlaAlertAt = Date.now();
      const alert = this.alerts.createSystemAlert(
        `Data freshness SLA breached: ${f.freshness_seconds}s exceeds SLA of ${f.sla_seconds}s.`,
        "CRITICAL"
      );
      this.emit("message", { type: "alert", payload: alert } satisfies WsMessage);
    });

    this.alerts.on("alert", (alert) => {
      this.emit("message", { type: "alert", payload: alert } satisfies WsMessage);
    });
    this.alerts.on("incident", (incident) => {
      this.emit("message", {
        type: "incident",
        payload: incident,
      } satisfies WsMessage);
      const advisory = generateAdvisory(
        incident,
        this.alerts.getAlerts(),
        this.processor.getPrimarySnapshot()
      );
      this.emit("message", {
        type: "ai_advisory",
        payload: advisory,
      } satisfies WsMessage);
    });

    this.broadcastTimer = setInterval(() => this.broadcastState(), 1000);
    this.rateTimer = setInterval(() => {
      this.lastProcessingRate = this.processedInSecond;
      this.processedInSecond = 0;
    }, 1000);

    logger.info("hub_started");
  }

  stop() {
    this.simulator.stop();
    this.freshness.stop();
    if (this.broadcastTimer) clearInterval(this.broadcastTimer);
    if (this.rateTimer) clearInterval(this.rateTimer);
  }

  setConnectedClients(n: number) {
    this.freshness.setClients(n);
  }

  demo(command: DemoCommand) {
    logger.info("demo_command", { command });
    switch (command) {
      case "START_NORMAL":
        this.simulator.startNormal();
        break;
      case "SIMULATE_ANOMALY":
        this.simulator.simulateAnomaly();
        break;
      case "SIMULATE_INCIDENT":
        this.simulator.simulateIncident();
        break;
      case "SIMULATE_PIPELINE_FAILURE":
        this.simulator.simulatePipelineFailure();
        break;
      case "RECOVER_PIPELINE":
        this.simulator.recoverPipeline();
        break;
      case "HIGH_LOAD":
        this.simulator.simulateHighLoad();
        break;
      case "STOP":
        this.simulator.stop();
        this.freshness.setIngestionStatus("PAUSED");
        break;
    }
  }

  getSimulationState() {
    return this.simulator.getState();
  }

  getSnapshot() {
    const kpi = this.buildKpi();
    const health = this.freshness.getHealth(
      this.processor.getEventRatePerMinute(),
      this.lastProcessingRate
    );
    const prediction = forecastBreach(this.processor.getTimeSeries());
    return {
      kpi,
      health,
      alerts: this.alerts.getAlerts(),
      incidents: this.alerts.getIncidents(),
      timeseries: this.processor.getTimeSeries(),
      regions: this.buildRegions(),
      risk: this.lastRisk,
      prediction,
      mode: this.simulator.getMode(),
    };
  }

  private onEvent(event: StreamEvent) {
    const receivedAt = Date.now();
    try {
      this.freshness.recordEvent(event.timestamp, receivedAt);
      const snapshot = this.processor.ingest(event);
      this.processedInSecond += 1;

      const prev = this.regionAgg.get(event.region) ?? {
        value: event.value,
        baseline: event.baseline_value,
        alerts: 0,
      };
      this.regionAgg.set(event.region, {
        value: event.value * 0.3 + prev.value * 0.7,
        baseline: event.baseline_value,
        alerts: prev.alerts,
      });

      const anomaly = this.detector.evaluate(event, snapshot);
      const risk = computeRiskScore({
        event,
        snapshot,
        persistenceMs: anomaly.persistence_ms,
        severity: anomaly.severity,
        escalationRate: snapshot.rate_of_change,
      });
      this.lastRisk = {
        score: Math.round(this.lastRisk.score * 0.7 + risk.score * 0.3),
        risk_score: Math.round(this.lastRisk.score * 0.7 + risk.score * 0.3),
        contributors: risk.contributors.length
          ? risk.contributors
          : this.lastRisk.contributors,
        severity: risk.severity,
        timestamp: risk.timestamp,
      };

      this.emit("message", {
        type: "event",
        payload: event,
      } satisfies WsMessage);

      if (anomaly.isAnomaly) {
        this.alerts.maybeCreate(event, anomaly, risk);
        const r = this.regionAgg.get(event.region);
        if (r) r.alerts += 1;
      }
    } catch (err) {
      this.freshness.recordFailure();
      logger.error("event_processing_failure", { error: String(err) });
    }
  }

  private broadcastState() {
    this.alerts.tickDurations();
    const kpi = this.buildKpi();
    const health = this.freshness.getHealth(
      this.processor.getEventRatePerMinute(),
      this.lastProcessingRate
    );
    const metric = this.processor.getPrimarySnapshot();
    const prediction = forecastBreach(this.processor.getTimeSeries());

    this.emit("message", { type: "kpi", payload: kpi } satisfies WsMessage);
    this.emit("message", { type: "metric", payload: metric } satisfies WsMessage);
    this.emit("message", { type: "health", payload: health } satisfies WsMessage);
    this.emit("message", { type: "risk", payload: this.lastRisk } satisfies WsMessage);
    this.emit("message", {
      type: "timeseries",
      payload: this.processor.getTimeSeries(),
    } satisfies WsMessage);
    this.emit("message", {
      type: "regions",
      payload: this.buildRegions(),
    } satisfies WsMessage);
    this.emit("message", {
      type: "prediction",
      payload: prediction,
    } satisfies WsMessage);
  }

  private buildKpi(): KpiSnapshot {
    const snap = this.processor.getPrimarySnapshot();
    const freshness = this.freshness.getFreshness();
    return {
      events_per_minute: this.processor.getEventRatePerMinute(),
      current_value: snap.current_value,
      active_alerts: this.alerts.getActiveAlertCount(),
      critical_incidents: this.alerts.getCriticalIncidentCount(),
      risk_score: this.lastRisk.score,
      data_freshness_seconds: freshness.freshness_seconds,
      timestamp: new Date().toISOString(),
    };
  }

  private buildRegions(): RegionState[] {
    return REGIONS.map((r) => {
      const agg = this.regionAgg.get(r.id);
      const value = agg?.value ?? 0;
      const baseline = agg?.baseline ?? 1;
      const deviation =
        baseline === 0 ? 0 : ((value - baseline) / baseline) * 100;
      const activeAlerts = this.alerts
        .getAlerts({ region: r.id, status: "ACTIVE" })
        .length;
      const status =
        activeAlerts > 0 && Math.abs(deviation) > 80
          ? "CRITICAL"
          : activeAlerts > 0 || Math.abs(deviation) > 40
            ? "WARNING"
            : "NORMAL";
      return {
        id: r.id,
        name: r.name,
        lat: r.lat,
        lng: r.lng,
        status,
        current_value: Math.round(value * 100) / 100,
        baseline: Math.round(baseline * 100) / 100,
        deviation: Math.round(deviation * 10) / 10,
        risk_score: Math.min(
          100,
          Math.round(Math.abs(deviation) / 2 + activeAlerts * 15)
        ),
        active_alerts: activeAlerts,
      };
    });
  }
}

export const hub = new SentinelHub();

// Re-export config reference for load tests
void config;
