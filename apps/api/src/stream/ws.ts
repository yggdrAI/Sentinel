import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import type { WsMessage } from "@sentinel/shared";
import { hub } from "../hub.js";
import { logger } from "../logger.js";

export type StreamAttachment = {
  wss: WebSocketServer;
  clients: Set<WebSocket>;
  close: () => void;
};

/**
 * Attach WebSocket real-time stream. Cleans up timers/listeners on close().
 */
export function attachWebSocket(server: Server): StreamAttachment {
  const wss = new WebSocketServer({ server, path: "/ws" });
  const clients = new Set<WebSocket>();

  const onMessage = (msg: WsMessage) => {
    const data = JSON.stringify(msg);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  };

  hub.on("message", onMessage);

  const heartbeat = setInterval(() => {
    const payload: WsMessage = {
      type: "heartbeat",
      payload: { ts: new Date().toISOString(), clients: clients.size },
    };
    const data = JSON.stringify(payload);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  }, 5000);

  wss.on("connection", (socket) => {
    clients.add(socket);
    hub.setConnectedClients(clients.size);
    logger.info("stream_connection", { clients: clients.size });

    const snapshot: WsMessage = {
      type: "snapshot",
      payload: hub.getSnapshot(),
    };
    socket.send(JSON.stringify(snapshot));

    socket.on("close", () => {
      clients.delete(socket);
      hub.setConnectedClients(clients.size);
      logger.info("stream_disconnection", { clients: clients.size });
    });

    socket.on("error", (err) => {
      logger.error("ws_client_error", { error: String(err) });
    });

    socket.on("message", (raw) => {
      try {
        const parsed = JSON.parse(String(raw)) as { type?: string };
        if (parsed.type === "ping") {
          socket.send(
            JSON.stringify({
              type: "heartbeat",
              payload: {
                ts: new Date().toISOString(),
                clients: clients.size,
              },
            } satisfies WsMessage)
          );
        }
      } catch {
        /* ignore */
      }
    });
  });

  const close = () => {
    clearInterval(heartbeat);
    hub.off("message", onMessage);
    for (const c of clients) {
      try {
        c.close();
      } catch {
        /* ignore */
      }
    }
    clients.clear();
    hub.setConnectedClients(0);
    wss.close();
  };

  wss.on("close", () => {
    clearInterval(heartbeat);
    hub.off("message", onMessage);
  });

  return { wss, clients, close };
}
