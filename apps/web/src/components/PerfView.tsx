import { useState } from "react";
import type { LoadTestResult } from "@sentinel/shared";
import { runPerfTest } from "../lib/api";
import { fmtNum } from "../lib/format";

const TARGETS = [1000, 5000, 10000];

export function PerfView() {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<LoadTestResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function runAll() {
    setRunning(true);
    setError(null);
    const out: LoadTestResult[] = [];
    try {
      for (const eps of TARGETS) {
        const r = (await runPerfTest(eps, 3)) as LoadTestResult;
        out.push(r);
        setResults([...out]);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--line)] bg-ink-900/90 p-5 shadow-panel">
        <h2 className="text-lg font-semibold text-mist-100">Performance validation</h2>
        <p className="mt-1 max-w-2xl text-sm text-mist-300">
          Runs an in-process load test against the real processing, anomaly, and risk
          path. Numbers below are measured — not fabricated.
        </p>
        <button
          disabled={running}
          onClick={runAll}
          className="mt-4 rounded-md border border-signal-accent/40 bg-signal-accent/10 px-4 py-2 text-sm text-signal-accent disabled:opacity-50"
        >
          {running ? "Running load tests…" : "Run 1k / 5k / 10k eps suite"}
        </button>
        {error && <p className="mt-2 text-sm text-signal-crit">{error}</p>}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {results.map((r) => (
          <div
            key={`${r.target_eps}-${r.started_at}`}
            className="rounded-xl border border-[var(--line)] bg-ink-900 p-4 animate-fadeUp"
          >
            <div className="font-mono text-[10px] uppercase text-mist-400">Event load</div>
            <div className="font-mono text-2xl text-mist-100">
              {r.target_eps.toLocaleString()} /sec
            </div>
            <dl className="mt-4 space-y-2 text-xs">
              <Row k="Throughput" v={`${fmtNum(r.throughput_eps, 0)} eps`} />
              <Row k="Avg latency" v={`${fmtNum(r.avg_latency_ms, 3)} ms`} />
              <Row k="P95 latency" v={`${fmtNum(r.p95_latency_ms, 3)} ms`} />
              <Row k="Success rate" v={`${fmtNum(r.success_rate, 3)}%`} />
              <Row k="Data loss" v={`${fmtNum(r.data_loss_pct, 3)}%`} />
              <Row k="Processed" v={String(r.events_processed)} />
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-mist-400">{k}</dt>
      <dd className="font-mono text-mist-100">{v}</dd>
    </div>
  );
}
