import { Router } from "express";
import { randomUUID } from "node:crypto";
import { requireAuth } from "../auth.js";
import { getTrack } from "../db.js";
import { trackToItem } from "../jellyfinShapes.js";

export const playbackInfoRouter = Router();
playbackInfoRouter.use(requireAuth);

/**
 * Jellyfin clients (e.g. Finamp) call this before streaming to discover the actual
 * media source(s) for an item and get a play session id. We only ever have a single,
 * direct-play-capable source per track (see trackToItem()), so this just reuses that
 * shape rather than duplicating it.
 */
function handlePlaybackInfo(req: import("express").Request, res: import("express").Response) {
  const track = getTrack(req.params.id);
  if (!track) {
    res.status(404).json({ error: "Track not found" });
    return;
  }

  const item = trackToItem(track);
  res.json({
    MediaSources: item.MediaSources,
    PlaySessionId: randomUUID(),
  });
}

playbackInfoRouter.get("/Items/:id/PlaybackInfo", handlePlaybackInfo);
playbackInfoRouter.post("/Items/:id/PlaybackInfo", handlePlaybackInfo);
