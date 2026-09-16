import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TimeSeriesPoint } from "@sentinel/shared";

export function LiveChart({ data }: { data: TimeSeriesPoint[] }) {
  const chartData = data.map((p) => ({
    ...p,
    time: new Date(p.t).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
  }));

  const threshold = data.length ? data[data.length - 1]!.threshold : 0;

  return (
    <section
      className="flex h-full min-h-[280px] flex-col rounded-lg border border-[var(--line)] bg-ink-900 p-4"
      aria-label="Live time series"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold tracking-wide text-mist-100">
            Live time series
          </h2>
          <p className="text-xs text-mist-400">
            Backend rolling window — value, baseline, threshold
          </p>
        </div>
        <div className="flex flex-wrap gap-3 font-mono text-[10px] uppercase text-mist-400">
          <span className="flex items-center gap-1">
            <i className="h-2 w-2 rounded-full bg-signal-accent" aria-hidden />{" "}
            Value
          </span>
          <span className="flex items-center gap-1">
            <i className="h-2 w-2 rounded-full bg-mist-400" aria-hidden />{" "}
            Baseline
          </span>
          <span className="flex items-center gap-1">
            <i className="h-2 w-2 rounded-full bg-signal-crit" aria-hidden />{" "}
            Threshold
          </span>
        </div>
      </div>

      {chartData.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-mist-400">
          Waiting for backend time-series points…
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData}>
              <defs>
                <linearGradient id="valFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#7dd3c7" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#7dd3c7" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(100,116,139,0.2)" vertical={false} />
              <XAxis
                dataKey="time"
                tick={{ fill: "#64748b", fontSize: 10 }}
                minTickGap={40}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "#64748b", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={42}
              />
              <Tooltip
                contentStyle={{
                  background: "#111722",
                  border: "1px solid rgba(125,211,199,0.2)",
                  borderRadius: 6,
                  fontSize: 12,
                }}
              />
              {threshold > 0 && (
                <ReferenceLine
                  y={threshold}
                  stroke="#ff5c5c"
                  strokeDasharray="4 4"
                  strokeOpacity={0.85}
                />
              )}
              <Area
                type="monotone"
                dataKey="value"
                stroke="#7dd3c7"
                fill="url(#valFill)"
                strokeWidth={2}
                isAnimationActive={false}
                dot={(props) => {
                  const { cx, cy, payload } = props as {
                    cx?: number;
                    cy?: number;
                    payload?: TimeSeriesPoint;
                  };
                  if (!payload?.anomaly || cx == null || cy == null) {
                    return <g key={`d-${cx}-${cy}`} />;
                  }
                  return (
                    <circle
                      key={`a-${cx}-${cy}`}
                      cx={cx}
                      cy={cy}
                      r={3}
                      fill="#ff5c5c"
                    />
                  );
                }}
              />
              <Line
                type="monotone"
                dataKey="baseline"
                stroke="#8b9bb3"
                strokeWidth={1.5}
                strokeDasharray="3 3"
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
