import { Router, type Request, type Response } from "express";
import { requireAuth } from "../auth.js";
import { getPlaylistByExternalId, getPlaylistTracks, getPlaylists, getTrack } from "../db.js";
import { externalPlaylistId, MUSIC_LIBRARY_ID, musicLibraryItem, playlistToItem, trackToItem } from "../jellyfinShapes.js";

export const itemsRouter = Router();
itemsRouter.use(requireAuth);

function parsePagination(query: Record<string, unknown>): { startIndex: number; limit?: number } {
  const rawStartIndex = query.StartIndex ?? query.startIndex;
  const rawLimit = query.Limit ?? query.limit;

  const startIndex = typeof rawStartIndex === "string" ? Math.max(0, parseInt(rawStartIndex, 10) || 0) : 0;
  let limit: number | undefined;
  if (typeof rawLimit === "string") {
    const parsed = parseInt(rawLimit, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      limit = parsed;
    }
  }

  return { startIndex, limit };
}

/**
 * Top-level library list. Jellite only ever exposes a single fake "Music" library —
 * see musicLibraryItem() for why clients like Finamp need this instead of playlists
 * being returned directly here.
 */
function listViews(_req: unknown, res: Response) {
  const library = musicLibraryItem();
  res.json({ Items: [library], TotalRecordCount: 1, StartIndex: 0 });
}

itemsRouter.get("/Users/:userId/Views", listViews);
// Some clients (e.g. Feishin) call the top-level "/UserViews?userId=..." form instead.
itemsRouter.get("/UserViews", listViews);

/**
 * Lists items (playlists, or playlist tracks if ParentId is given).
 * Supports Jellyfin pagination parameters: StartIndex, Limit.
 */
function listItems(req: Request, res: Response) {
  const query = req.query as Record<string, unknown>;
  const { startIndex, limit } = parsePagination(query);

  const idsParam = (query.Ids ?? query.ids) as string | undefined;
  if (idsParam) {
    const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
    const matchedItems: unknown[] = [];
    for (const id of ids) {
      const playlist = getPlaylistByExternalId(externalPlaylistId, id);
      if (playlist) {
        matchedItems.push(playlistToItem(playlist, getPlaylistTracks(playlist.id).length));
        continue;
      }
      const track = getTrack(id);
      if (track) {
        matchedItems.push(trackToItem(track));
        continue;
      }
    }
    const paged = limit !== undefined ? matchedItems.slice(startIndex, startIndex + limit) : matchedItems.slice(startIndex);
    res.json({ Items: paged, TotalRecordCount: matchedItems.length, StartIndex: startIndex });
    return;
  }

  const parentId = (query.ParentId ?? query.parentId) as string | undefined;
  if (parentId && parentId !== MUSIC_LIBRARY_ID && parentId !== "0") {
    const playlist = getPlaylistByExternalId(externalPlaylistId, parentId);
    if (playlist) {
      const tracks = getPlaylistTracks(playlist.id);
      const allItems = tracks.map((track, index) => trackToItem(track, externalPlaylistId(playlist.id), index + 1));
      const paged = limit !== undefined ? allItems.slice(startIndex, startIndex + limit) : allItems.slice(startIndex);
      res.json({ Items: paged, TotalRecordCount: allItems.length, StartIndex: startIndex });
      return;
    }

    res.json({ Items: [], TotalRecordCount: 0, StartIndex: startIndex });
    return;
  }

  const playlists = getPlaylists();
  const allItems = playlists.map((playlist) => playlistToItem(playlist, getPlaylistTracks(playlist.id).length));
  const paged = limit !== undefined ? allItems.slice(startIndex, startIndex + limit) : allItems.slice(startIndex);
  res.json({ Items: paged, TotalRecordCount: allItems.length, StartIndex: startIndex });
}

itemsRouter.get("/Items", listItems);
itemsRouter.get("/Users/:userId/Items", listItems);

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
function getItem(req: Request, res: Response) {
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
}

itemsRouter.get("/Users/:userId/Items/:itemId", getItem);
itemsRouter.get("/Items/:itemId", getItem);

