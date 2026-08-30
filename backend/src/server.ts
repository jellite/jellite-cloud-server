import http from "node:http";
import http2 from "node:http2";
import net from "node:net";
import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { authRouter } from "./routes/auth.js";
import { systemRouter } from "./routes/system.js";
import { usersRouter } from "./routes/users.js";
import { itemsRouter } from "./routes/items.js";
import { playlistsRouter } from "./routes/playlists.js";
import { imagesRouter } from "./routes/images.js";
import { audioRouter } from "./routes/audio.js";
import { playbackInfoRouter } from "./routes/playbackInfo.js";
import { sessionsRouter } from "./routes/sessions.js";
import { displayPreferencesRouter } from "./routes/displayPreferences.js";
import { webdavRouter } from "./routes/webdav.js";
import { webRouter } from "./routes/web.js";
import { attachSocketServer } from "./routes/socket.js";

const app = express();

app.use("/web", webRouter);

// Mounted before the global `cors()` middleware below: cors() intercepts and
// auto-responds to *every* OPTIONS request (not just browser CORS preflights), which
// would otherwise swallow WebDAV clients' OPTIONS capability probe before it ever reached
// webdavRouter's own handler (which needs to set the `DAV: 1` header, not a CORS one).
// /webdav is for native desktop/mobile clients (e.g. foobar2000), not browsers, so it has
// no need for CORS handling anyway.
app.use("/webdav", webdavRouter);

// Allow browser-based clients (Jellyfin Web, Finamp web, custom dashboards, ...) to call
// this API cross-origin. Jellyfin clients authenticate via custom headers rather than
// cookies, so credentials aren't required, but we still need to whitelist those headers
// and expose response headers some web clients read (e.g. streaming range info).
const corsOptions: cors.CorsOptions = {
  origin: config.corsAllowedOrigins.includes("*") ? true : config.corsAllowedOrigins,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD", "PROPFIND"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Emby-Authorization",
    "X-Emby-Token",
    "X-MediaBrowser-Token",
    "X-Emby-Client",
    "X-Emby-Device-Name",
    "X-Emby-Device-Id",
    "X-Emby-Client-Version",
    "Range",
  ],
  exposedHeaders: ["Content-Range", "Content-Length", "Accept-Ranges"],
  maxAge: 86400,
};
app.use(cors(corsOptions));
app.use(express.json());

// TEMPORARY debug logging (added to diagnose a Finamp "add server" failure — remove once
// resolved, see git history / plan.md). Logs method+path+status+response body for every
// request so we can see exactly which field Finamp's client chokes on.
app.use((req, res, next) => {
  const started = Date.now();
  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    console.log(
      `[debug] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - started}ms)\n` +
        JSON.stringify(body)
    );
    return originalJson(body);
  };
  console.log(`[debug] <- ${req.method} ${req.originalUrl} headers=${JSON.stringify(req.headers)}`);
  next();
});

app.use(systemRouter);
app.use(authRouter);
app.get("/healthz", (_req, res) => res.send("ok"));

// imagesRouter must be mounted before any router with a blanket `router.use(requireAuth)`
// (users/items/playlists/audio/playbackInfo below) — Express invokes each mounted
// router's own middleware for every request that reaches it (since they're all mounted
// at "/"), so an earlier router's unconditional requireAuth would reject unauthenticated
// image requests before imagesRouter ever got a chance to handle them (real Jellyfin
// serves images without a token, and so does Finamp's image loader — see images.ts).
app.use(imagesRouter);

app.use(usersRouter);
app.use(itemsRouter);
app.use(playlistsRouter);
app.use(audioRouter);
app.use(playbackInfoRouter);
app.use(sessionsRouter);
app.use(displayPreferencesRouter);

app.use((_req, res) => res.status(404).json({ error: "Not found" }));

const prohibitedHttp2Headers = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
]);

function startServer(): void {
  // Express 4 depends on HTTP/1 request/response internals, while Cloud Run's end-to-end
  // HTTP/2 mode sends h2c to the container. Keep Express on an unreachable loopback port
  // and proxy the public h2c server to it. This removes Cloud Run's 32MB HTTP/1.1 response
  // limit without changing the routing or middleware behavior of the existing app.
  const appServer = http.createServer(app);
  attachSocketServer(appServer);

  appServer.listen(0, "127.0.0.1", () => {
    const address = appServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Unable to determine internal HTTP server port");
    }

    const h2Server = http2.createServer();
    h2Server.on("stream", (stream, headers) => {
      const method = headers[":method"];
      const path = headers[":path"];
      if (!method || !path) {
        stream.respond({ ":status": 400 });
        stream.end();
        return;
      }

      const requestHeaders: http.OutgoingHttpHeaders = {};
      for (const [name, value] of Object.entries(headers)) {
        if (!name.startsWith(":")) requestHeaders[name] = value;
      }

      const upstreamRequest = http.request(
        { host: "127.0.0.1", port: address.port, method, path, headers: requestHeaders },
        (upstreamResponse) => {
          const responseHeaders: http2.OutgoingHttpHeaders = { ":status": upstreamResponse.statusCode ?? 502 };
          for (const [name, value] of Object.entries(upstreamResponse.headers)) {
            if (value !== undefined && !prohibitedHttp2Headers.has(name.toLowerCase())) {
              responseHeaders[name] = value;
            }
          }
          stream.respond(responseHeaders);
          upstreamResponse.pipe(stream);
        }
      );

      upstreamRequest.on("error", () => {
        if (!stream.closed) {
          stream.respond({ ":status": 502 });
          stream.end();
        }
      });
      stream.on("error", () => upstreamRequest.destroy());
      stream.pipe(upstreamRequest);
    });

    const multiplexer = net.createServer((socket) => {
      socket.once("data", (chunk) => {
        socket.pause();
        socket.unshift(chunk);
        if (chunk.length >= 3 && chunk.slice(0, 3).toString() === "PRI") {
          h2Server.emit("connection", socket);
        } else {
          appServer.emit("connection", socket);
        }
        process.nextTick(() => socket.resume());
      });
    });

    multiplexer.listen(config.port, () => {
      // eslint-disable-next-line no-console
      console.log(`Jellite backend listening on port ${config.port}`);
    });
  });
}

startServer();
