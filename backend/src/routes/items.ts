import { Router } from "express";
import { requireAuth } from "../auth.js";
import { getPlaylist, getPlaylistTracks, getPlaylists, getTrack } from "../db.js";
import { musicLibraryItem, playlistToItem, trackToItem } from "../jellyfinShapes.js";

export const itemsRouter = Router();
itemsRouter.use(requireAuth);

/**
 * Top-level library list. Jellite only ever exposes a single fake "Music" library —
 * see musicLibraryItem() for why clients like Finamp need this instead of playlists
 * being returned directly here.
 */
itemsRouter.get("/Users/:userId/Views", (_req, res) => {
  const library = musicLibraryItem();
  res.json({ Items: [library], TotalRecordCount: 1, StartIndex: 0 });
});

/**
 * Children of the "Music" library (or any other parentId/filter clients throw at us —
 * since Jellite only ever has playlists to offer, we return the flat playlist list
 * regardless; see SPEC.md — no album/artist/genre browsing). Finamp calls this as
 * `/Users/{userId}/Items`, not the bare `/Items` — support both.
 */
function listPlaylists(_req: unknown, res: import("express").Response) {
  const playlists = getPlaylists();
  const items = playlists.map((playlist) => playlistToItem(playlist, getPlaylistTracks(playlist.id).length));
  res.json({ Items: items, TotalRecordCount: items.length, StartIndex: 0 });
}

itemsRouter.get("/Items", listPlaylists);
itemsRouter.get("/Users/:userId/Items", listPlaylists);

/**
 * Fetches a single item by id — Finamp uses this for both playlists and tracks
 * (`/Users/{userId}/Items/{itemId}`).
 */
itemsRouter.get("/Users/:userId/Items/:itemId", (req, res) => {
  const { itemId } = req.params;

  const playlist = getPlaylist(itemId);
  if (playlist) {
    res.json(playlistToItem(playlist, getPlaylistTracks(playlist.id).length));
    return;
  }

  const track = getTrack(itemId);
  if (track) {
    res.json(trackToItem(track));
    return;
  }

  res.status(404).json({ error: "Item not found" });
});
