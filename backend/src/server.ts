import express from "express";
import { config } from "./config.js";
import { authRouter } from "./routes/auth.js";
import { systemRouter } from "./routes/system.js";
import { usersRouter } from "./routes/users.js";
import { itemsRouter } from "./routes/items.js";
import { playlistsRouter } from "./routes/playlists.js";
import { imagesRouter } from "./routes/images.js";
import { audioRouter } from "./routes/audio.js";

const app = express();
app.use(express.json());

app.use(systemRouter);
app.use(authRouter);
app.get("/healthz", (_req, res) => res.send("ok"));

app.use(usersRouter);
app.use(itemsRouter);
app.use(playlistsRouter);
app.use(imagesRouter);
app.use(audioRouter);

app.use((_req, res) => res.status(404).json({ error: "Not found" }));

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Jellite backend listening on port ${config.port}`);
});
