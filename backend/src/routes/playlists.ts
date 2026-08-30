import { Router, type Request, type Response } from "express";
import { requireAuth } from "../auth.js";
import { getPlaylistByExternalId, getPlaylistTracks } from "../db.js";
import { externalPlaylistId, playlistToItem, trackToItem } from "../jellyfinShapes.js";

export const playlistsRouter = Router();
playlistsRouter.use(requireAuth);

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

playlistsRouter.get("/Playlists/:id/Items", (req: Request, res: Response) => {
  const playlist = getPlaylistByExternalId(externalPlaylistId, req.params.id);
  if (!playlist) {
    res.status(404).json({ error: "Playlist not found" });
    return;
  }

  const { startIndex, limit } = parsePagination(req.query as Record<string, unknown>);
  const tracks = getPlaylistTracks(playlist.id);
  const allItems = tracks.map((track, index) => trackToItem(track, externalPlaylistId(playlist.id), index + 1));
  const pagedItems = limit !== undefined ? allItems.slice(startIndex, startIndex + limit) : allItems.slice(startIndex);
  res.json({ Items: pagedItems, TotalRecordCount: allItems.length, StartIndex: startIndex });
});

playlistsRouter.get("/Playlists/:id", (req: Request, res: Response) => {
  const playlist = getPlaylistByExternalId(externalPlaylistId, req.params.id);
  if (!playlist) {
    res.status(404).json({ error: "Playlist not found" });
    return;
  }

  res.json(playlistToItem(playlist, getPlaylistTracks(playlist.id).length));
});

