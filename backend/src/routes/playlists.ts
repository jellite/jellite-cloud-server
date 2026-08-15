import { Router } from "express";
import { requireAuth } from "../auth.js";
import { getPlaylistByExternalId, getPlaylistTracks } from "../db.js";
import { externalPlaylistId, trackToItem } from "../jellyfinShapes.js";

export const playlistsRouter = Router();
playlistsRouter.use(requireAuth);

playlistsRouter.get("/Playlists/:id/Items", (req, res) => {
  const playlist = getPlaylistByExternalId(externalPlaylistId, req.params.id);
  if (!playlist) {
    res.status(404).json({ error: "Playlist not found" });
    return;
  }

  const tracks = getPlaylistTracks(playlist.id);
  const items = tracks.map((track, index) => trackToItem(track, externalPlaylistId(playlist.id), index));
  res.json({ Items: items, TotalRecordCount: items.length, StartIndex: 0 });
});
