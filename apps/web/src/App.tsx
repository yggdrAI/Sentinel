import { useState } from "react";
import { useCommandCenter } from "./lib/useCommandCenter";
import { Header } from "./components/Header";
import { KpiStrip } from "./components/KpiStrip";
import { LiveChart } from "./components/LiveChart";
import { AlertPanel } from "./components/AlertPanel";
import { IncidentPanel } from "./components/IncidentPanel";
import { PipelineHealthPanel } from "./components/PipelineHealthPanel";
import { DemoControls } from "./components/DemoControls";
import { EventStream } from "./components/EventStream";
import { RiskPanel } from "./components/RiskPanel";
import { AlertCenter } from "./components/AlertCenter";

type View = "command" | "alerts";

export default function App() {
  const cc = useCommandCenter();
  const [view, setView] = useState<View>("command");

  const activeIncidents = cc.incidents.filter(
    (i) => i.status !== "RESOLVED"
  ).length;

  return (
    <div className="min-h-full">
      <Header
        connection={cc.connection}
        freshness={cc.freshness}
        health={cc.health}
        mode={cc.simulation?.mode ?? cc.mode}
        view={view}
        onView={setView}
      />

      <main className="mx-auto max-w-[1600px] space-y-4 px-5 py-4">
        {cc.restError && !cc.bootstrapped && (
          <div
            className="rounded border border-signal-crit/40 bg-signal-crit/10 px-4 py-3 text-sm text-signal-crit"
            role="alert"
          >
            API snapshot failed: {cc.restError}. WebSocket may still restore
            state.
          </div>
        )}

        {view === "command" && (
          <>
            <KpiStrip
              kpi={cc.kpi}
              freshness={cc.freshness}
              activeIncidents={activeIncidents}
            />

            <DemoControls
              simulation={cc.simulation}
              mode={cc.mode}
              onTrigger={cc.triggerDemo}
            />

            <div className="grid gap-4 xl:grid-cols-[1.45fr_0.95fr]">
              <div className="space-y-4">
                <div className="h-[320px] md:h-[360px]">
                  <LiveChart data={cc.timeseries} />
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <PipelineHealthPanel
                    health={cc.health}
                    freshness={cc.freshness}
                  />
                  <IncidentPanel
                    incidents={cc.incidents}
                    alerts={cc.alerts}
                    risk={cc.risk}
                  />
                </div>
                <EventStream events={cc.eventHistory} />
              </div>

              <div className="grid gap-4 content-start">
                <div className="h-[420px] xl:h-[480px]">
                  <AlertPanel
                    alerts={cc.alerts.filter((a) => a.status !== "RESOLVED")}
                    compact
                    onAcknowledge={cc.acknowledge}
                    onResolve={cc.resolve}
                  />
                </div>
                <RiskPanel risk={cc.risk} />
              </div>
            </div>
          </>
        )}

        {view === "alerts" && (
          <AlertCenter
            alerts={cc.alerts}
            incidents={cc.incidents}
            audit={cc.audit}
            events={cc.eventHistory}
            onAcknowledge={cc.acknowledge}
            onAssign={cc.assign}
            onUnassign={cc.unassign}
            onEscalate={cc.escalate}
            onResolve={cc.resolve}
          />
        )}
      </main>
    </div>
  );
}
