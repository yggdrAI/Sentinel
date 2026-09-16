import { runLoadTest } from "../src/perf/loadRunner.js";

const targets = [1000, 5000, 10000];
const duration = Number(process.env.LOAD_DURATION || 3);

async function main() {
  console.log("SENTINEL Load Test — measuring actual processing path\n");
  for (const eps of targets) {
    const result = await runLoadTest(eps, duration);
    console.log(
      JSON.stringify(
        {
          target_eps: result.target_eps,
          throughput_eps: result.throughput_eps,
          avg_latency_ms: result.avg_latency_ms,
          p95_latency_ms: result.p95_latency_ms,
          success_rate: result.success_rate,
          data_loss_pct: result.data_loss_pct,
          events_processed: result.events_processed,
        },
        null,
        2
      )
    );
    console.log("---");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
