# SENTINEL API

Base URL: `http://localhost:4000`

## Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Process health |
| GET | `/health/stream` | Pipeline / freshness |
| GET | `/health/metrics` | KPI + thresholds |

## Snapshot & domain

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/snapshot` | Full state snapshot |
| GET | `/api/alerts` | Query: `severity`, `region`, `metric`, `status` |
| POST | `/api/alerts/:id/acknowledge` | ACTIVE → ACKNOWLEDGED |
| POST | `/api/alerts/:id/resolve` | → RESOLVED |
| GET | `/api/incidents` | Incidents list |
| GET | `/api/regions` | Geo region states |
| GET | `/api/advisory` | Decision-support advisory |
| GET | `/api/config/public` | Non-secret thresholds / SLA |

## Demo controls

```http
POST /api/demo
Content-Type: application/json

{ "command": "SIMULATE_INCIDENT" }
```

Commands: `START_NORMAL` | `SIMULATE_ANOMALY` | `SIMULATE_INCIDENT` | `SIMULATE_PIPELINE_FAILURE` | `RECOVER_PIPELINE` | `HIGH_LOAD` | `STOP`

## Simulation control API

| Method | Path | Effect |
|--------|------|--------|
| POST | `/simulation/normal` | Start/resume NORMAL |
| POST | `/simulation/high-load` | HIGH_LOAD |
| POST | `/simulation/anomaly` | ANOMALY |
| POST | `/simulation/incident` | INCIDENT |
| POST | `/simulation/failure` | PIPELINE_FAILURE |
| POST | `/simulation/recover` | Recover to NORMAL |
| GET | `/simulation/status` | `SimulationState` |

## Performance

```http
POST /api/perf/run
Content-Type: application/json

{ "target_eps": 5000, "duration_seconds": 3 }
```

```http
GET /api/perf
```

Returns last measured `LoadTestResult`.

## WebSocket

`ws://localhost:4000/ws`

Client receives JSON envelopes:

```json
{ "type": "kpi", "payload": { ... } }
```

Types: `snapshot`, `event`, `kpi`, `metric`, `alert`, `incident`, `health`, `freshness`, `timeseries`, `regions`, `risk`, `prediction`, `ai_advisory`, `heartbeat`, `mode`

Send `{ "type": "ping" }` for an immediate heartbeat reply.
