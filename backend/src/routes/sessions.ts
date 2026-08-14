import { Router } from "express";
import { requireAuth } from "../auth.js";

export const sessionsRouter = Router();
sessionsRouter.use(requireAuth);

/**
 * Finamp reports playback start/progress/stop to these three endpoints
 * (jellyfin_api_helper.dart: reportPlaybackStart/updatePlaybackProgress/stopPlaybackProgress).
 * We don't track play sessions server-side (see SPEC.md — Jellite has no "now playing"/
 * history features), but the endpoints must exist and return 204 like real Jellyfin does,
 * otherwise Finamp gets a 404 whenever the user seeks (updatePlaybackProgress is called on
 * every seek) and, depending on client version, can abort playback entirely.
 */
sessionsRouter.post("/Sessions/Playing", (_req, res) => {
  res.sendStatus(204);
});

sessionsRouter.post("/Sessions/Playing/Progress", (_req, res) => {
  res.sendStatus(204);
});

sessionsRouter.post("/Sessions/Playing/Stopped", (_req, res) => {
  res.sendStatus(204);
});
