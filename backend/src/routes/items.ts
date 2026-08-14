import { Router } from "express";
import { requireAuth } from "../auth.js";
import { getPlaylistTracks, getPlaylists } from "../db.js";
import { playlistToItem } from "../jellyfinShapes.js";

export const itemsRouter = Router();
itemsRouter.use(requireAuth);

/**
 * Clients typically list top-level browsable collections via `/Users/{id}/Views` and then
 * fetch children via `/Items?parentId=...` or a similar query. Since Jellite only exposes
 * playlists (see SPEC.md — no library management via the API), both entry points simply
 * return the flat list of playlists.
 */
function listPlaylistItems(_req: unknown, res: import("express").Response) {
  const playlists = getPlaylists();
  const items = playlists.map((playlist) => playlistToItem(playlist, getPlaylistTracks(playlist.id).length));
  res.json({ Items: items, TotalRecordCount: items.length, StartIndex: 0 });
}

itemsRouter.get("/Users/:userId/Views", listPlaylistItems);
itemsRouter.get("/Items", listPlaylistItems);
