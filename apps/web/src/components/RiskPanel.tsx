import type { RiskScore } from "@sentinel/shared";

export function RiskPanel({ risk }: { risk: RiskScore | null }) {
  return (
    <section
      className="rounded-lg border border-[var(--line)] bg-ink-900 p-4"
      aria-label="Risk score"
    >
      <h2 className="text-sm font-semibold text-mist-100">Risk score</h2>
      <p className="text-xs text-mist-400">Deterministic operational model</p>
      <div className="mt-2 flex items-end gap-3">
        <span className="font-mono text-4xl font-semibold tabular-nums text-mist-100">
          {risk ? risk.score : "—"}
        </span>
        <span className="mb-1 font-mono text-xs text-mist-400">/ 100</span>
      </div>
      <ul className="mt-3 space-y-1">
        {(risk?.contributors ?? []).map((c) => (
          <li
            key={c.label}
            className="font-mono text-[11px] text-mist-300"
          >
            +{c.points} {c.label}
          </li>
        ))}
        {!risk?.contributors?.length && (
          <li className="text-xs text-mist-400">No elevated risk factors</li>
        )}
      </ul>
    </section>
  );
}
