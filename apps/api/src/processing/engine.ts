import type { StreamEvent, MetricSnapshot, TimeSeriesPoint } from "@sentinel/shared";
import { config } from "../config.js";

type WindowPoint = {
  t: number;
  value: number;
  baseline: number;
  status: string;
  region: string;
  service: string;
  metric: string;
};

/**
 * Rolling-window processor for KPIs, rates, and statistical baselines.
 */
export class ProcessingEngine {
  private readonly windows = new Map<string, WindowPoint[]>();
  private readonly globalWindow: WindowPoint[] = [];
  private readonly maxPoints: number;
  private eventsProcessed = 0;
  private errorsInWindow = 0;
  private readonly eventTimestamps: number[] = [];

  constructor(windowSize = config.rollingWindowSize) {
    this.maxPoints = Math.max(30, windowSize);
  }

  ingest(event: StreamEvent): MetricSnapshot {
    const t = Date.now();
    const point: WindowPoint = {
      t,
      value: event.value,
      baseline: event.baseline_value,
      status: event.status,
      region: event.region,
      service: event.service,
      metric: event.metric,
    };

    const key = `${event.metric}|${event.region}|${event.service}`;
    const series = this.windows.get(key) ?? [];
    series.push(point);
    if (series.length > this.maxPoints) series.shift();
    this.windows.set(key, series);

    this.globalWindow.push(point);
    if (this.globalWindow.length > this.maxPoints * 3) this.globalWindow.shift();

    this.eventsProcessed += 1;
    this.eventTimestamps.push(t);
    // Keep ~2 minutes of timestamps for rate
    while (
      this.eventTimestamps.length &&
      t - this.eventTimestamps[0]! > 120_000
    ) {
      this.eventTimestamps.shift();
    }

    if (event.status === "error") this.errorsInWindow += 1;

    return this.snapshotFor(event.metric, event.region, event.service);
  }

  snapshotFor(
    metric: string,
    region?: string,
    service?: string
  ): MetricSnapshot {
    const points = this.selectPoints(metric, region, service);
    const values = points.map((p) => p.value);
    const current = values.length ? values[values.length - 1]! : 0;
    const mean = avg(values);
    const std = stdDev(values, mean);
    const baseline =
      points.length > 0
        ? avg(points.map((p) => p.baseline))
        : current;
    const prev =
      values.length > 1 ? values[values.length - 2]! : current;
    const rateOfChange = current - prev;
    const percentageDeviation =
      baseline === 0 ? 0 : ((current - baseline) / baseline) * 100;
    const z = std === 0 ? 0 : (current - mean) / std;
    const now = Date.now();
    const recent = this.eventTimestamps.filter((x) => now - x <= 60_000);
    const errorCount = points.filter((p) => p.status === "error").length;
    const errorRate =
      points.length === 0 ? 0 : (errorCount / points.length) * 100;

    return {
      metric,
      region,
      service,
      current_value: round(current, 3),
      rolling_average: round(mean, 3),
      baseline: round(baseline, 3),
      rate_of_change: round(rateOfChange, 3),
      percentage_deviation: round(percentageDeviation, 2),
      z_score: round(z, 3),
      std_dev: round(std, 3),
      event_rate: recent.length,
      events_per_second: round(recent.length / 60, 2),
      error_rate: round(errorRate, 2),
      timestamp: new Date().toISOString(),
    };
  }

  getPrimarySnapshot(): MetricSnapshot {
    return this.snapshotFor(config.primaryMetric);
  }

  getTimeSeries(metric = config.primaryMetric, limit = 90): TimeSeriesPoint[] {
    const points = this.selectPoints(metric);
    const threshold = config.thresholds[metric] ?? 0;
    const slice = points.slice(-limit);
    return slice.map((p) => {
      const mean = avg(slice.map((x) => x.value));
      const std = stdDev(
        slice.map((x) => x.value),
        mean
      );
      const z = std === 0 ? 0 : (p.value - mean) / std;
      return {
        t: p.t,
        value: p.value,
        baseline: p.baseline,
        threshold,
        anomaly:
          Math.abs(z) >= config.anomalyZScoreThreshold ||
          (threshold > 0 && p.value > threshold),
      };
    });
  }

  getEventRatePerMinute(): number {
    const now = Date.now();
    return this.eventTimestamps.filter((x) => now - x <= 60_000).length;
  }

  getEventRatePerSecond(): number {
    return this.getEventRatePerMinute() / 60;
  }

  getEventsProcessed(): number {
    return this.eventsProcessed;
  }

  getGlobalDeviationMs(): number {
    // duration above elevated mean for primary metric
    const points = this.selectPoints(config.primaryMetric);
    if (points.length < 5) return 0;
    const mean = avg(points.map((p) => p.value));
    const threshold = config.thresholds[config.primaryMetric] ?? mean * 1.5;
    let start: number | null = null;
    for (const p of points) {
      if (p.value > threshold || p.value > mean * 1.4) {
        if (start === null) start = p.t;
      } else {
        start = null;
      }
    }
    return start ? Date.now() - start : 0;
  }

  private selectPoints(
    metric: string,
    region?: string,
    service?: string
  ): WindowPoint[] {
    if (!region && !service) {
      return this.globalWindow.filter((p) => p.metric === metric);
    }
    const out: WindowPoint[] = [];
    for (const [key, series] of this.windows) {
      const [m, r, s] = key.split("|");
      if (m !== metric) continue;
      if (region && r !== region) continue;
      if (service && s !== service) continue;
      out.push(...series);
    }
    out.sort((a, b) => a.t - b.t);
    return out.slice(-this.maxPoints);
  }
}

function avg(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const v =
    values.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
}

function round(n: number, d: number) {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}
