from __future__ import annotations

import os
import time

import httpx
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

API = os.getenv("API_BASE_URL", "http://127.0.0.1:8080")

st.set_page_config(page_title="PulseGuard", layout="wide", page_icon="🛡")

st.markdown(
    """
    <style>
      .block-container {padding-top: 2.4rem; padding-bottom: 1rem; max-width: 1400px;}
      div[data-testid="stMetric"] {background:#111827; border:1px solid #1f2937; border-radius:12px; padding:12px;}
      .pg-banner {display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:0.6rem;}
      .pg-title {font-size:1.8rem; font-weight:700; letter-spacing:0.02em;}
      .pg-sub {color:#93a4b8; font-size:0.92rem;}
    </style>
    """,
    unsafe_allow_html=True,
)


def api(method: str, path: str, **kwargs):
    try:
        r = httpx.request(method, f"{API}{path}", timeout=8.0, **kwargs)
        r.raise_for_status()
        return r.json()
    except Exception as exc:
        return {"_error": str(exc)}


def badge(label: str, ok: bool) -> str:
    color = "#34d399" if ok else "#f43f5e"
    return f"<span style='background:{color}22;color:{color};padding:4px 10px;border-radius:999px;font-weight:600;margin-left:8px'>{label}</span>"


def line_fig(df: pd.DataFrame, y: str, title: str, color: str, hline=None) -> go.Figure:
    fig = go.Figure()
    if df.empty:
        fig.update_layout(title=title, template="plotly_dark", height=280, paper_bgcolor="#0b1220", plot_bgcolor="#0b1220")
        return fig
    fig.add_trace(
        go.Scatter(
            x=pd.to_datetime(df["ts"], unit="s"),
            y=df[y],
            mode="lines",
            line=dict(color=color, width=2),
            fill="tozeroy",
            fillcolor="rgba(34,211,238,0.12)",
            name=y,
        )
    )
    if hline is not None:
        fig.add_hline(y=hline, line_dash="dash", line_color="#fbbf24", annotation_text="threshold")
    fig.update_layout(
        title=title,
        template="plotly_dark",
        height=280,
        margin=dict(l=10, r=10, t=40, b=10),
        paper_bgcolor="#0b1220",
        plot_bgcolor="#0b1220",
        xaxis=dict(showgrid=False),
        yaxis=dict(gridcolor="#1f2937"),
        showlegend=False,
    )
    return fig


st.markdown(
    "<div class='pg-banner'><div><div class='pg-title'>PulseGuard</div>"
    "<div class='pg-sub'>Real-time fraud / risk threshold command center</div></div></div>",
    unsafe_allow_html=True,
)

with st.sidebar:
    st.header("Demo controls")
    cols = st.columns(2)
    if cols[0].button("Normal", use_container_width=True):
        api("POST", "/control", json={"action": "normal"})
    if cols[1].button("Fraud spike", use_container_width=True):
        api("POST", "/control", json={"action": "fraud_spike"})
    cols = st.columns(2)
    if cols[0].button("Velocity", use_container_width=True):
        api("POST", "/control", json={"action": "velocity_attack"})
    if cols[1].button("Declines", use_container_width=True):
        api("POST", "/control", json={"action": "decline_storm"})
    cols = st.columns(2)
    if cols[0].button("Pipeline fail", use_container_width=True):
        api("POST", "/control", json={"action": "pipeline_fail"})
    if cols[1].button("Recover", use_container_width=True):
        api("POST", "/control", json={"action": "recover"})
    if st.button("Clear alerts", use_container_width=True):
        api("POST", "/control", json={"action": "clear_alerts"})
    st.divider()
    st.caption("Simulator rate")
    eps = st.slider("Events / second", 1.0, 40.0, 12.0, 1.0)
    if st.button("Apply rate", use_container_width=True):
        api("POST", "/control", json={"action": "set_rate", "eps": eps})
    st.divider()
    st.subheader("Load test")
    target = st.selectbox("Target EPS", [1000, 2000, 5000], index=1)
    if st.button("Run load test", use_container_width=True):
        with st.spinner("Measuring ingest path…"):
            st.session_state["perf"] = api(
                "POST", "/perf/run", json={"target_eps": int(target), "duration_seconds": 3}
            )


@st.fragment(run_every=2.0)
def live() -> None:
    metrics = api("GET", "/metrics")
    if "_error" in metrics:
        st.warning(f"Waiting for API at {API} — {metrics['_error']}")
        return
    kpi = metrics["kpi"]
    th = metrics["thresholds"]
    fresh_ok = kpi["freshness"] == "HEALTHY"
    live_ok = kpi["pipeline"] == "LIVE"
    st.markdown(
        f"**Mode** `{kpi['mode']}` "
        + badge("LIVE" if live_ok else kpi["pipeline"], live_ok)
        + badge(f"FRESHNESS {kpi['freshness']}", fresh_ok)
        + badge(f"SLA {th['freshness_sla_seconds']:.0f}s", fresh_ok),
        unsafe_allow_html=True,
    )
    c1, c2, c3, c4, c5, c6 = st.columns(6)
    c1.metric("TPS (60s)", f"{kpi['tps']:.2f}")
    c2.metric("Avg amount", f"${kpi['avg_amount']:.0f}")
    c3.metric("Decline %", f"{kpi['decline_rate']*100:.1f}%")
    c4.metric("Avg risk", f"{kpi['avg_risk']:.1f}")
    c5.metric("Alerts", kpi["active_alerts"])
    c6.metric("Event age", f"{kpi['last_event_age_s']:.2f}s", delta=f"lag {kpi['ingest_lag_ms']:.0f}ms")

    kpis = api("GET", "/kpis")
    hist = pd.DataFrame(kpis.get("history") or [])
    g1, g2 = st.columns(2)
    with g1:
        st.plotly_chart(line_fig(hist, "tps", "Throughput", "#22d3ee"), width="stretch")
        st.plotly_chart(
            line_fig(hist, "avg_risk", "Average risk score", "#fb7185", hline=th["risk_score"]),
            width="stretch",
        )
    with g2:
        st.plotly_chart(
            line_fig(hist, "decline_rate", "Decline rate", "#fbbf24", hline=th["decline_rate"]),
            width="stretch",
        )
        st.plotly_chart(
            line_fig(hist, "high_risk_share", "High-risk share", "#a78bfa", hline=th["high_risk_share"]),
            width="stretch",
        )

    left, right = st.columns((1.15, 0.85))
    alerts = api("GET", "/alerts").get("items") or []
    txns = api("GET", "/transactions").get("items") or []
    with left:
        st.subheader("Alerts")
        if not alerts:
            st.caption("No threshold breaches yet.")
        for row in alerts[:12]:
            box = st.container(border=True)
            with box:
                st.markdown(
                    f"**{row['title']}** · `{row['severity']}` · `{row['status']}`  \n"
                    f"{row['reason']}"
                )
                b1, b2, _ = st.columns((0.2, 0.2, 0.6))
                if b1.button("Ack", key=f"ack-{row['alert_id']}", disabled=row["status"] != "ACTIVE"):
                    api("POST", f"/alerts/{row['alert_id']}/ack")
                    st.rerun()
                if b2.button("Resolve", key=f"res-{row['alert_id']}", disabled=row["status"] == "RESOLVED"):
                    api("POST", f"/alerts/{row['alert_id']}/resolve")
                    st.rerun()
    with right:
        st.subheader("Live transactions")
        if txns:
            df = pd.DataFrame(txns)
            show = df[
                ["ts", "account_id", "merchant", "amount", "status", "risk_score", "channel"]
            ].copy()
            show["ts"] = pd.to_datetime(show["ts"], unit="s").dt.strftime("%H:%M:%S")
            st.dataframe(show, hide_index=True, width="stretch", height=420)
        azure = metrics.get("azure") or {}
        if azure.get("enabled"):
            st.caption(
                f"Fabric/Event Hub sink: sent={azure.get('sent')} queued={azure.get('queued')} errors={azure.get('errors')}"
            )
        else:
            st.caption("Azure Event Hub sink disabled (offline demo).")

    perf = st.session_state.get("perf")
    if perf and "_error" not in perf:
        st.subheader("Last load test")
        p1, p2, p3, p4, p5 = st.columns(5)
        p1.metric("Actual EPS", perf["actual_eps"])
        p2.metric("p50", f"{perf['p50_ms']:.2f} ms")
        p3.metric("p95", f"{perf['p95_ms']:.2f} ms")
        p4.metric("Success", f"{perf['success_rate']*100:.1f}%")
        p5.metric("Events", perf["events"])
    st.caption(f"Auto-refresh 2s · {time.strftime('%H:%M:%S')}")


live()
