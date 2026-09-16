import type { Prediction, TimeSeriesPoint } from "@sentinel/shared";
import { config } from "../config.js";

/**
 * Lightweight linear short-term forecast from recent time-series slope.
 */
export function forecastBreach(
  series: TimeSeriesPoint[],
  forecastMinutes = 15
): Prediction {
  const metric = config.primaryMetric;
  const threshold = config.thresholds[metric] ?? 0;
  if (series.length < 5) {
    return {
      current_value: 0,
      forecast_value: 0,
      forecast_minutes: forecastMinutes,
      threshold,
      breach_eta_minutes: null,
      message: "Insufficient history for forecast.",
      advisory: true,
    };
  }

  const recent = series.slice(-20);
  const current = recent[recent.length - 1]!.value;
  const first = recent[0]!;
  const last = recent[recent.length - 1]!;
  const dtMin = Math.max(0.01, (last.t - first.t) / 60_000);
  const slopePerMin = (last.value - first.value) / dtMin;
  const forecast = current + slopePerMin * forecastMinutes;

  let breachEta: number | null = null;
  let message = `Current ${current.toFixed(1)}; forecast in ${forecastMinutes}m: ${forecast.toFixed(1)} (threshold ${threshold}).`;

  if (threshold > 0 && current < threshold && slopePerMin > 0) {
    const mins = (threshold - current) / slopePerMin;
    if (mins > 0 && mins <= forecastMinutes * 2) {
      breachEta = Math.round(mins * 10) / 10;
      message = `Potential threshold breach in approximately ${breachEta} minutes.`;
    }
  } else if (threshold > 0 && current >= threshold) {
    message = `Threshold already breached (current ${current.toFixed(1)} ≥ ${threshold}).`;
    breachEta = 0;
  } else if (slopePerMin <= 0) {
    message = `Trend stable/declining; no near-term breach predicted within ${forecastMinutes} minutes.`;
  }

  return {
    current_value: round(current, 2),
    forecast_value: round(forecast, 2),
    forecast_minutes: forecastMinutes,
    threshold,
    breach_eta_minutes: breachEta,
    message,
    advisory: true,
  };
}

function round(n: number, d: number) {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}
