import { Router } from "express";
import { requireAuth } from "../auth.js";
import { getPlaylistTracks, getPlaylists } from "../db.js";
import { musicLibraryItem, playlistToItem } from "../jellyfinShapes.js";

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
 * regardless; see SPEC.md — no album/artist/genre browsing).
 */
itemsRouter.get("/Items", (_req, res) => {
  const playlists = getPlaylists();
  const items = playlists.map((playlist) => playlistToItem(playlist, getPlaylistTracks(playlist.id).length));
  res.json({ Items: items, TotalRecordCount: items.length, StartIndex: 0 });
});
