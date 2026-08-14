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

/**
 * Logs out the current session. Jellite has no server-side session state to invalidate
 * (static single access token, see config.ts), so this is a no-op that just returns 204
 * like real Jellyfin — clients (jellyfin-vue, Feishin) call this on user-initiated logout
 * and treat any non-2xx as a failure to clear their local session.
 */
sessionsRouter.post("/Sessions/Logout", (_req, res) => {
  res.sendStatus(204);
});
