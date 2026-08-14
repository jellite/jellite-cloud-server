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

const app = express();
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

app.use(usersRouter);
app.use(itemsRouter);
app.use(playlistsRouter);
app.use(imagesRouter);
app.use(audioRouter);
app.use(playbackInfoRouter);

app.use((_req, res) => res.status(404).json({ error: "Not found" }));

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Jellite backend listening on port ${config.port}`);
});
