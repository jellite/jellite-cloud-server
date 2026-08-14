import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import { config } from "../config.js";

// How often (seconds) we ask clients to send a "KeepAlive" message, echoed back in the
// initial "ForceKeepAlive" message per the Jellyfin websocket protocol. Clients (Feishin,
// jellyfin-vue, ...) open this to receive real-time session/library-change push events;
// Jellite has no such events to push (static, read-only DB — see SPEC.md), so this is a
// minimal keep-alive-only implementation that just prevents clients from treating the
// missing endpoint as a hard error / reconnect-looping against a 404.
const KEEP_ALIVE_SECONDS = 30;

function extractQueryToken(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const query = new URL(url, "http://localhost").searchParams;
  return query.get("api_key") ?? query.get("ApiKey") ?? undefined;
}

export function attachSocketServer(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({ MessageType: "ForceKeepAlive", Data: KEEP_ALIVE_SECONDS }));

    ws.on("message", (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message?.MessageType === "KeepAlive") {
          ws.send(JSON.stringify({ MessageType: "KeepAlive" }));
        }
      } catch {
        // Ignore anything that isn't valid JSON — we don't implement any other message
        // types (no server-initiated events to relay), so there's nothing to act on.
      }
    });
  });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = req.url ? new URL(req.url, "http://localhost").pathname : "";
    if (path !== "/socket") {
      return;
    }

    const token = extractQueryToken(req.url);
    if (token !== config.accessToken) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });
}
