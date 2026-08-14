import { Router } from "express";
import { requireAuth } from "../auth.js";
import { getPlaylist, getPlaylistPrimaryTrack, getTrack } from "../db.js";

export const imagesRouter = Router();
imagesRouter.use(requireAuth);

function sendCover(res: import("express").Response, cover: Buffer | null | undefined) {
  if (!cover) {
    res.status(404).json({ error: "No image" });
    return;
  }
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=604800, immutable");
  res.send(cover);
}

// Track cover art, extracted from embedded FLAC/M4A tags during sync (see SPEC.md).
imagesRouter.get("/Items/:id/Images/Primary", (req, res) => {
  const track = getTrack(req.params.id);
  if (track) {
    sendCover(res, track.cover_thumbnail);
    return;
  }

  // Playlist cover art = cover of its first track (see SPEC.md), resolved on demand so we
  // don't need to duplicate image bytes per playlist in the DB.
  const playlist = getPlaylist(req.params.id);
  if (playlist) {
    const firstTrack = getPlaylistPrimaryTrack(playlist.id);
    sendCover(res, firstTrack?.cover_thumbnail);
    return;
  }

  res.status(404).json({ error: "Not found" });
});
