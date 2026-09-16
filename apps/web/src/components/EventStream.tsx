import type { StreamEvent } from "@sentinel/shared";
import { fmtNum } from "../lib/format";

export function EventStream({ events }: { events: StreamEvent[] }) {
  return (
    <section
      className="rounded-lg border border-[var(--line)] bg-ink-900"
      aria-label="Event activity stream"
    >
      <div className="border-b border-[var(--line)] px-4 py-3">
        <h2 className="text-sm font-semibold text-mist-100">
          Event activity
        </h2>
        <p className="text-xs text-mist-400">
          Recent WebSocket events from the backend simulator
        </p>
      </div>
      <div className="max-h-[220px] overflow-y-auto">
        {events.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-mist-400">
            No events yet — waiting for live stream
          </p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-ink-850 font-mono text-[10px] uppercase text-mist-400">
              <tr>
                <th className="px-4 py-2 font-medium">Time</th>
                <th className="px-2 py-2 font-medium">Region</th>
                <th className="px-2 py-2 font-medium">Service</th>
                <th className="px-2 py-2 font-medium">Metric</th>
                <th className="px-4 py-2 font-medium text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr
                  key={e.event_id}
                  className="border-t border-[var(--line)]/60 font-mono text-mist-200"
                >
                  <td className="px-4 py-1.5 tabular-nums text-mist-400">
                    {new Date(e.server_timestamp || e.timestamp).toLocaleTimeString()}
                  </td>
                  <td className="px-2 py-1.5 capitalize">{e.region}</td>
                  <td className="px-2 py-1.5">{e.service}</td>
                  <td className="px-2 py-1.5">{e.metric}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums text-mist-100">
                    {fmtNum(e.value, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
