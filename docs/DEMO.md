# SENTINEL Demo Script (Judges)

**Goal:** Show the full live chain in ~3–4 minutes.

## Prep

```bash
npm install
npm run build -w @sentinel/shared
npm run dev
```

Open http://localhost:5173

## Script

### 1. Normal operations (30s)

- Point out **LIVE** indicator and **Data freshness** (sub-second, SLA &lt; 5s, HEALTHY).
- KPI strip updating: Events/min, current value, risk, freshness.
- Chart scrolling with live value + baseline + threshold.

### 2. Anomaly (45s)

- Click **Simulate anomaly**.
- Watch gradual climb → spike, anomaly dots on chart, risk contributors rise.
- Explain L1/L2/L3 detection (threshold, z-score, persistence).

### 3. Critical incident + operator workflow (60s)

- Click **Simulate critical incident**.
- Alert appears with **written explanation** (never unexplained).
- Incident panel shows duration + risk.
- Open **Alerts** → Acknowledge → Resolve.
- Show Decision support panel labeled **AI advisory**.

### 4. Pipeline failure + freshness SLA (60s)

- Click **Simulate pipeline failure**.
- Freshness age climbs; status → DEGRADED/CRITICAL.
- System alert: “Data freshness SLA breached…”.
- Click **Recover pipeline** → stream resumes, freshness HEALTHY.

### 5. Performance (30s)

- Open **Perf** → run 1k/5k/10k suite.
- Emphasize measured throughput, latency, success rate, data loss (not fabricated).

### 6. Optional geo (20s)

- Open **Geo** → region markers reflect live status; click for metrics/alerts/risk.

## Talking points

- Problem Statement #34: decisions while data is warm — freshness SLA is first-class.
- Architecture is stream-replaceable (Event Hubs / Fabric / Kafka later).
- Working software over over-engineering: single API + WebSocket + React UI.
