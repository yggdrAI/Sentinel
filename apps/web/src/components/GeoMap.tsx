import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { RegionState } from "@sentinel/shared";
import { fmtNum, statusColor } from "../lib/format";

const STATUS_COLOR: Record<string, string> = {
  NORMAL: "#3dffa8",
  WARNING: "#f5b942",
  CRITICAL: "#ff5c5c",
};

export function GeoMap({ regions }: { regions: RegionState[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [selected, setSelected] = useState<RegionState | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap",
          },
        },
        layers: [
          {
            id: "osm",
            type: "raster",
            source: "osm",
            paint: {
              "raster-saturation": -0.85,
              "raster-brightness-min": 0.1,
              "raster-brightness-max": 0.45,
            },
          },
        ],
      },
      center: [78.9, 22.5],
      zoom: 4.2,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    for (const r of regions) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "sentinel-region-marker";
      el.style.cssText = `
        width: 18px; height: 18px; border-radius: 999px;
        background: ${STATUS_COLOR[r.status] ?? "#64748b"};
        border: 2px solid rgba(7,9,13,0.9);
        box-shadow: 0 0 0 4px ${STATUS_COLOR[r.status] ?? "#64748b"}33;
        cursor: pointer;
      `;
      el.title = r.name;
      el.onclick = () => setSelected(r);
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([r.lng, r.lat])
        .addTo(map);
      markersRef.current.push(marker);
    }
  }, [regions]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div
        ref={containerRef}
        className="h-[520px] overflow-hidden rounded-xl border border-[var(--line)] shadow-panel"
      />
      <aside className="rounded-xl border border-[var(--line)] bg-ink-900/90 p-4 shadow-panel">
        <h2 className="text-sm font-semibold text-mist-100">Region detail</h2>
        <p className="mb-3 text-xs text-mist-400">
          Connected to live simulated stream
        </p>
        {selected ? (
          <div className="space-y-2 text-sm">
            <div className="text-lg font-medium">{selected.name}</div>
            <div className={`font-mono text-xs ${statusColor(selected.status)}`}>
              {selected.status}
            </div>
            <Row label="Current" value={fmtNum(selected.current_value)} />
            <Row label="Baseline" value={fmtNum(selected.baseline)} />
            <Row label="Deviation" value={`${fmtNum(selected.deviation)}%`} />
            <Row label="Risk" value={fmtNum(selected.risk_score, 0)} />
            <Row label="Active alerts" value={String(selected.active_alerts)} />
          </div>
        ) : (
          <p className="text-sm text-mist-400">Select a region marker</p>
        )}
        <ul className="mt-6 space-y-2 border-t border-[var(--line)] pt-4">
          {regions.map((r) => (
            <li key={r.id}>
              <button
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-white/5"
                onClick={() => setSelected(r)}
              >
                <span>{r.name}</span>
                <span className={`font-mono ${statusColor(r.status)}`}>{r.status}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-mist-400">{label}</span>
      <span className="font-mono text-mist-100">{value}</span>
    </div>
  );
}
