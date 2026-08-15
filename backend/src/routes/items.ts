import { Router } from "express";
import { requireAuth } from "../auth.js";
import { getPlaylistByExternalId, getPlaylistTracks, getPlaylists, getTrack } from "../db.js";
import { externalPlaylistId, musicLibraryItem, playlistToItem, trackToItem } from "../jellyfinShapes.js";

export const itemsRouter = Router();
itemsRouter.use(requireAuth);

/**
 * Top-level library list. Jellite only ever exposes a single fake "Music" library —
 * see musicLibraryItem() for why clients like Finamp need this instead of playlists
 * being returned directly here.
 */
function listViews(_req: unknown, res: import("express").Response) {
  const library = musicLibraryItem();
  res.json({ Items: [library], TotalRecordCount: 1, StartIndex: 0 });
}

itemsRouter.get("/Users/:userId/Views", listViews);
// Some clients (e.g. Feishin) call the top-level "/UserViews?userId=..." form instead.
itemsRouter.get("/UserViews", listViews);

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
 * Jellite has no genre/album/artist metadata to browse (see SPEC.md — playlists only),
 * so this always returns an empty, correctly-shaped list rather than 404ing. Some clients
 * (e.g. Feishin) call this unconditionally on startup and choke on a missing route/error
 * response even though an empty genre list is a perfectly normal Jellyfin answer.
 */
itemsRouter.get("/MusicGenres", (_req, res) => {
  res.json({ Items: [], TotalRecordCount: 0, StartIndex: 0 });
});
itemsRouter.get("/Genres", (_req, res) => {
  res.json({ Items: [], TotalRecordCount: 0, StartIndex: 0 });
});

/**
 * Homepage widgets some clients (jellyfin-vue, Feishin) request unconditionally on
 * login, regardless of library type. Jellite has no watch/listen history or TV content
 * (see SPEC.md), so these are always empty — matches what real Jellyfin returns for a
 * fresh library/user anyway, just without the 404 in between.
 */
itemsRouter.get("/Items/Latest", (_req, res) => {
  res.json([]);
});
itemsRouter.get("/Shows/NextUp", (_req, res) => {
  res.json({ Items: [], TotalRecordCount: 0, StartIndex: 0 });
});
itemsRouter.get("/UserItems/Resume", (_req, res) => {
  res.json({ Items: [], TotalRecordCount: 0, StartIndex: 0 });
});

/**
 * Fetches a single item by id — Finamp uses this for both playlists and tracks
 * (`/Users/{userId}/Items/{itemId}`).
 */
itemsRouter.get("/Users/:userId/Items/:itemId", (req, res) => {
  const { itemId } = req.params;

  const playlist = getPlaylistByExternalId(externalPlaylistId, itemId);
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
