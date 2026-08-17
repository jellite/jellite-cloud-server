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
import { attachSocketServer } from "./routes/socket.js";

const app = express();

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

const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Jellite backend listening on port ${config.port}`);
});
attachSocketServer(server);
