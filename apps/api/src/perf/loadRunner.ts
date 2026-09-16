import type { LoadTestResult } from "@sentinel/shared";
import { ProcessingEngine } from "../processing/engine.js";
import { AnomalyDetector } from "../anomaly/detector.js";
import { computeRiskScore } from "../anomaly/risk.js";
import type { StreamEvent } from "@sentinel/shared";
import { randomUUID } from "node:crypto";
import { logger } from "../logger.js";

let lastResult: LoadTestResult | null = null;

export function getLastLoadTestResult() {
  return lastResult;
}

/**
 * Synthetic in-process load test measuring actual processing throughput/latency.
 */
export async function runLoadTest(
  targetEps: number,
  durationSeconds: number
): Promise<LoadTestResult> {
  const processor = new ProcessingEngine(120);
  const detector = new AnomalyDetector();
  const startedAt = new Date();
  const latencies: number[] = [];
  let sent = 0;
  let processed = 0;
  let dropped = 0;

  const total = targetEps * durationSeconds;
  const batch = Math.max(1, Math.floor(targetEps / 100));
  const intervalMs = 10;
  const end = Date.now() + durationSeconds * 1000;

  logger.info("load_test_started", { targetEps, durationSeconds });

  await new Promise<void>((resolve) => {
    const tick = () => {
      if (Date.now() >= end || sent >= total) {
        resolve();
        return;
      }
      const n = Math.min(batch, total - sent);
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        const event = makeEvent(sent);
        sent += 1;
        try {
          const snap = processor.ingest(event);
          detector.evaluate(event, snap);
          computeRiskScore({
            event,
            snapshot: snap,
            persistenceMs: 0,
            severity: "INFO",
            escalationRate: snap.rate_of_change,
          });
          processed += 1;
          latencies.push(performance.now() - t0);
        } catch {
          dropped += 1;
        }
      }
      setImmediate(tick);
    };
    // pace roughly toward target
    const paced = () => {
      if (Date.now() >= end || sent >= total) {
        resolve();
        return;
      }
      const expected = ((Date.now() - startedAt.getTime()) / 1000) * targetEps;
      const deficit = expected - sent;
      const n = Math.max(0, Math.min(batch * 2, Math.ceil(deficit)));
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        const event = makeEvent(sent);
        sent += 1;
        try {
          const snap = processor.ingest(event);
          detector.evaluate(event, snap);
          processed += 1;
          latencies.push(performance.now() - t0);
        } catch {
          dropped += 1;
        }
      }
      setTimeout(paced, intervalMs);
    };
    void tick;
    paced();
  });

  const finishedAt = new Date();
  const elapsed = Math.max(
    0.001,
    (finishedAt.getTime() - startedAt.getTime()) / 1000
  );
  latencies.sort((a, b) => a - b);
  const avg =
    latencies.length === 0
      ? 0
      : latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const p95 = percentile(latencies, 0.95);
  const p99 = percentile(latencies, 0.99);
  const successRate = sent === 0 ? 0 : (processed / sent) * 100;
  const dataLoss = sent === 0 ? 0 : (dropped / sent) * 100;

  lastResult = {
    target_eps: targetEps,
    duration_seconds: durationSeconds,
    events_sent: sent,
    events_processed: processed,
    throughput_eps: Math.round((processed / elapsed) * 100) / 100,
    avg_latency_ms: Math.round(avg * 1000) / 1000,
    p95_latency_ms: Math.round(p95 * 1000) / 1000,
    p99_latency_ms: Math.round(p99 * 1000) / 1000,
    dropped_events: dropped,
    success_rate: Math.round(successRate * 1000) / 1000,
    data_loss_pct: Math.round(dataLoss * 1000) / 1000,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
  };

  logger.info("load_test_finished", {
    throughput: lastResult.throughput_eps,
    avg_latency_ms: lastResult.avg_latency_ms,
  });

  return lastResult;
}

function makeEvent(i: number): StreamEvent {
  const now = Date.now();
  const ts = new Date(now - 10).toISOString();
  return {
    event_id: randomUUID(),
    timestamp: ts,
    server_timestamp: new Date(now).toISOString(),
    region: ["north", "south", "east", "west", "central"][i % 5]!,
    service: ["payments", "identity", "logistics", "telemetry", "grid"][i % 5]!,
    metric: "failure_rate",
    value: 1 + (i % 50) * 0.05,
    baseline_value: 1.2,
    status: "ok",
    source: "load-test",
  };
}

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx]!;
}
