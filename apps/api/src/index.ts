import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { config } from "./config.js";
import { router } from "./routes.js";
import { hub } from "./hub.js";
import { attachWebSocket } from "./stream/ws.js";
import { logger } from "./logger.js";

const app = express();
app.use(
  cors({
    origin: config.corsOrigin.split(",").map((s) => s.trim()),
    methods: ["GET", "POST", "OPTIONS"],
  })
);
app.use(express.json({ limit: "256kb" }));
app.use(router);

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    logger.error("http_error", { error: String(err) });
    res.status(500).json({ error: "Internal server error" });
  }
);

const server = createServer(app);
attachWebSocket(server);

hub.start();

server.listen(config.port, () => {
  logger.info("server_listening", {
    port: config.port,
    ws: `ws://localhost:${config.port}/ws`,
    health: `http://localhost:${config.port}/health`,
  });
});

function shutdown() {
  logger.info("server_shutdown");
  hub.stop();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
