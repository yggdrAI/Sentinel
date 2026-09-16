import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import {
  REGIONS,
  SERVICES,
  METRICS,
  type SimulationMode,
  type SimulationState,
  type StreamEvent,
} from "@sentinel/shared";
import { config } from "../config.js";
import { logger } from "../logger.js";

type SimOptions = {
  speed?: number;
};

/**
 * Continuous event simulator with intentional temporal behaviour.
 * Modes alter rate and value dynamics; PIPELINE_FAILURE pauses emission.
 */
export class StreamSimulator extends EventEmitter {
  private mode: SimulationMode = "NORMAL";
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private paused = false;
  private tick = 0;
  private anomalyPhase = 0;
  private incidentStart = 0;
  private startedAt: string | null = null;
  private readonly baselines: Record<string, number> = {
    transaction_volume: 1200,
    failure_rate: 1.2,
    latency_ms: 120,
    throughput: 2800,
    error_rate: 0.8,
  };
  private readonly speed: number;

  constructor(options: SimOptions = {}) {
    super();
    this.speed = options.speed ?? config.simulationSpeed;
  }

  getMode(): SimulationMode {
    return this.mode;
  }

  getState(): SimulationState {
    return {
      mode: this.mode,
      running: this.running && !this.paused,
      paused: this.paused,
      target_events_per_minute: this.targetEpm(),
      tick: this.tick,
      started_at: this.startedAt,
    };
  }

  isRunning(): boolean {
    return this.running && !this.paused;
  }

  isPaused(): boolean {
    return this.paused;
  }

  start(mode: SimulationMode = "NORMAL") {
    this.mode = mode;
    this.paused = mode === "PIPELINE_FAILURE";
    this.running = true;
    this.startedAt = new Date().toISOString();
    this.anomalyPhase = 0;
    this.incidentStart = Date.now();
    this.scheduleNext();
    logger.info("simulator_started", { mode: this.mode });
    this.emit("mode", this.mode);
  }

  stop() {
    this.running = false;
    this.paused = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    logger.info("simulator_stopped");
  }

  /** Named demo controls */
  startNormal() {
    this.setMode("NORMAL");
  }
  simulateHighLoad() {
    this.setMode("HIGH_LOAD");
  }
  simulateAnomaly() {
    this.setMode("ANOMALY");
  }
  simulateIncident() {
    this.setMode("INCIDENT");
  }
  simulatePipelineFailure() {
    this.setMode("PIPELINE_FAILURE");
  }
  recoverPipeline() {
    this.setMode("NORMAL");
  }

  setMode(mode: SimulationMode) {
    const prev = this.mode;
    this.mode = mode;
    if (mode === "PIPELINE_FAILURE") {
      this.paused = true;
      logger.warn("pipeline_failure_simulated");
    } else {
      this.paused = false;
      if (mode === "ANOMALY") this.anomalyPhase = 0;
      if (mode === "INCIDENT") this.incidentStart = Date.now();
      if (!this.running) this.start(mode);
      else if (prev === "PIPELINE_FAILURE") {
        logger.info("pipeline_recovered");
        this.emit("recovered");
      }
    }
    this.emit("mode", this.mode);
    logger.info("simulator_mode_changed", { mode });
    if (this.running) this.scheduleNext();
  }

  targetEpm(): number {
    switch (this.mode) {
      case "HIGH_LOAD":
        return config.highLoadEventsPerMinute;
      case "ANOMALY":
        return config.normalEventsPerMinute * 1.35;
      case "INCIDENT":
        return config.normalEventsPerMinute * 1.6;
      case "PIPELINE_FAILURE":
        return 0;
      default:
        return config.normalEventsPerMinute;
    }
  }

  private scheduleNext() {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);

    const epm = this.paused
      ? Math.max(1, config.normalEventsPerMinute * this.speed)
      : Math.max(1, this.targetEpm() * this.speed);
    const batchSize =
      epm > 2000 ? Math.min(40, Math.ceil(epm / 600)) : epm > 800 ? 3 : 1;
    const intervalMs = Math.max(8, (60_000 / epm) * batchSize);

    this.timer = setTimeout(() => {
      if (!this.running) return;
      if (!this.paused) {
        for (let i = 0; i < batchSize; i++) {
          this.emit("event", this.generateEvent());
        }
      }
      this.scheduleNext();
    }, intervalMs);
  }

  private generateEvent(): StreamEvent {
    this.tick += 1;
    const region = REGIONS[this.tick % REGIONS.length]!;
    const service = SERVICES[this.tick % SERVICES.length]!;
    const metric =
      Math.random() < 0.45
        ? config.primaryMetric
        : METRICS[this.tick % METRICS.length]!;

    const baseline = this.baselines[metric] ?? 100;
    const value = this.computeValue(metric, baseline, region.id, service);
    const status =
      metric === "failure_rate" || metric === "error_rate"
        ? value > (config.thresholds[metric] ?? 5)
          ? "error"
          : value > baseline * 1.5
            ? "warn"
            : "ok"
        : value > (config.thresholds[metric] ?? Infinity)
          ? "warn"
          : "ok";

    const now = Date.now();
    const ingestDelay = 5 + Math.random() * 35;
    const serverTs = new Date(now).toISOString();
    const eventTs = new Date(now - ingestDelay).toISOString();

    return {
      event_id: randomUUID(),
      timestamp: eventTs,
      server_timestamp: serverTs,
      region: region.id,
      service,
      metric,
      value: round(value, 3),
      baseline_value: round(baseline, 3),
      status,
      source: "sentinel-simulator",
      metadata: {
        mode: this.mode,
        tick: this.tick,
        produced_at: serverTs,
        ingestion_latency_ms: round(ingestDelay, 1),
      },
    };
  }

  private computeValue(
    metric: string,
    baseline: number,
    regionId: string,
    service: string
  ): number {
    const t = this.tick;
    const wave = Math.sin(t / 40) * 0.08 + Math.sin(t / 11) * 0.03;
    const noise = (Math.random() - 0.5) * 0.06;
    let factor = 1 + wave + noise;

    if (regionId === "north" && service === "payments") factor *= 1.05;
    if (regionId === "west") factor *= 0.97;

    switch (this.mode) {
      case "NORMAL":
        break;
      case "HIGH_LOAD":
        factor *= 1.25 + Math.sin(t / 20) * 0.1;
        break;
      case "ANOMALY": {
        this.anomalyPhase += 1;
        const climb = Math.min(1.8, 1 + this.anomalyPhase / 80);
        const spike =
          this.anomalyPhase > 90 ? 1 + (this.anomalyPhase - 90) / 25 : 1;
        factor *= climb * spike;
        break;
      }
      case "INCIDENT": {
        const elapsed = (Date.now() - this.incidentStart) / 1000;
        const sustained = 2.2 + Math.min(1.5, elapsed / 60);
        if (
          (metric === "failure_rate" || metric === "error_rate") &&
          (service === "payments" || regionId === "north")
        ) {
          factor *= sustained;
        } else {
          factor *= 1.35;
        }
        break;
      }
      case "PIPELINE_FAILURE":
        break;
    }

    let value = baseline * factor;

    if (metric === "failure_rate" || metric === "error_rate") {
      value = Math.max(0.05, value);
      if (this.mode === "INCIDENT" && service === "payments") {
        value = Math.max(value, 6.5 + Math.sin(t / 8) * 1.5);
      }
      if (this.mode === "ANOMALY" && this.anomalyPhase > 70) {
        value = Math.max(value, 4 + this.anomalyPhase / 30);
      }
    }

    return value;
  }
}

function round(n: number, d: number) {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}
