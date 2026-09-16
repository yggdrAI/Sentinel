import type { DataFreshness, PipelineHealth, PipelineStatus } from "@sentinel/shared";
import { config } from "../config.js";
import { EventEmitter } from "node:events";
import { logger } from "../logger.js";

export class FreshnessMonitor extends EventEmitter {
  private lastEventAt: number | null = null;
  private lastEventTimestamp: string | null = null;
  private lastIngestionLatencyMs = 0;
  private eventsReceived = 0;
  private eventsProcessed = 0;
  private processingFailures = 0;
  private connectedClients = 0;
  private ingestionStatus: PipelineHealth["ingestion_status"] = "PAUSED";
  private slaBreached = false;
  private timer: NodeJS.Timeout | null = null;

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 500);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setClients(n: number) {
    this.connectedClients = n;
  }

  setIngestionStatus(status: PipelineHealth["ingestion_status"]) {
    this.ingestionStatus = status;
  }

  recordFailure() {
    this.processingFailures += 1;
  }

  recordEvent(eventTimestampIso: string, processedAt = Date.now()) {
    const eventTs = new Date(eventTimestampIso).getTime();
    this.lastIngestionLatencyMs = Math.max(0, processedAt - eventTs);
    this.lastEventAt = processedAt;
    this.lastEventTimestamp = eventTimestampIso;
    this.eventsReceived += 1;
    this.eventsProcessed += 1;

    if (this.slaBreached) {
      this.slaBreached = false;
      logger.info("freshness_sla_recovered");
      this.emit("recovered");
    }
  }

  getFreshness(): DataFreshness {
    const now = Date.now();
    const age =
      this.lastEventAt === null
        ? Number.POSITIVE_INFINITY
        : now - this.lastEventAt;
    const freshnessSeconds =
      age === Number.POSITIVE_INFINITY ? 9999 : age / 1000;
    const sla = config.freshnessSlaSeconds;
    const status = this.statusFromAge(freshnessSeconds, sla);
    return {
      last_event_at:
        this.lastEventAt === null
          ? null
          : new Date(this.lastEventAt).toISOString(),
      event_age_ms: age === Number.POSITIVE_INFINITY ? -1 : Math.round(age),
      ingestion_latency_ms: Math.round(this.lastIngestionLatencyMs),
      freshness_seconds: round(
        freshnessSeconds === 9999 ? 9999 : freshnessSeconds,
        2
      ),
      sla_seconds: sla,
      status,
      sla_breached: freshnessSeconds > sla,
    };
  }

  getHealth(eventsPerMinute: number, processingRate: number): PipelineHealth {
    const freshness = this.getFreshness();
    return {
      status: freshness.status,
      stream_connected: this.connectedClients > 0,
      connected_clients: this.connectedClients,
      events_received: this.eventsReceived,
      events_processed: this.eventsProcessed,
      processing_failures: this.processingFailures,
      events_per_minute: eventsPerMinute,
      events_per_second: round(eventsPerMinute / 60, 2),
      processing_rate: processingRate,
      last_successful_event: freshness.last_event_at,
      last_event_timestamp: this.lastEventTimestamp,
      ingestion_latency_ms: freshness.ingestion_latency_ms,
      ingestion_status: this.ingestionStatus,
      freshness,
      freshness_sla_seconds: config.freshnessSlaSeconds,
    };
  }

  private tick() {
    const freshness = this.getFreshness();
    this.emit("freshness", freshness);
    if (freshness.sla_breached && !this.slaBreached) {
      this.slaBreached = true;
      logger.warn("freshness_sla_breached", {
        freshness_seconds: freshness.freshness_seconds,
        sla: freshness.sla_seconds,
      });
      this.emit("sla_breach", freshness);
    }
  }

  private statusFromAge(seconds: number, sla: number): PipelineStatus {
    if (seconds === 9999) return "DISCONNECTED";
    if (seconds <= sla) return "HEALTHY";
    if (seconds <= sla * 2) return "DEGRADED";
    return "CRITICAL";
  }
}

function round(n: number, d: number) {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}
