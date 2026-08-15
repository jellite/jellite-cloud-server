import { Router } from "express";
import { getPlaylistByExternalId, getPlaylistPrimaryTrack, getPlaylists, getTrack, getTrackByAlbumOrArtistStableId } from "../db.js";
import { externalPlaylistId, MUSIC_LIBRARY_ID, stableId } from "../jellyfinShapes.js";

export const imagesRouter = Router();
// No requireAuth here: real Jellyfin serves item images without a token, and clients
// rely on that — Finamp's image widgets (e.g. AlbumImageProvider) fetch cover URLs via
// a plain NetworkImage with no Authorization header/query param at all, so requiring
// auth here just made every cover art request fail with 401.

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
  // don't need to duplicate image bytes per playlist in the DB. Playlist ids exposed to
  // clients are MD5 hashes of the real slug (see jellyfinShapes.ts externalPlaylistId),
  // so reverse-resolve before looking it up.
  const playlist = getPlaylistByExternalId(externalPlaylistId, req.params.id);
  if (playlist) {
    const firstTrack = getPlaylistPrimaryTrack(playlist.id);
    sendCover(res, firstTrack?.cover_thumbnail);
    return;
  }

  // The fake "Music" library itself (see musicLibraryItem()) has no cover of its own —
  // fall back to the first playlist's cover so clients like jellyfin-vue don't just show
  // a broken image/404 for the library tile.
  if (req.params.id === MUSIC_LIBRARY_ID) {
    const firstPlaylist = getPlaylists()[0];
    const firstTrack = firstPlaylist ? getPlaylistPrimaryTrack(firstPlaylist.id) : undefined;
    sendCover(res, firstTrack?.cover_thumbnail);
    return;
  }

  // Clients also request cover art for the synthetic album/artist ids embedded in track
  // metadata (AlbumId/ArtistItems, see jellyfinShapes.ts stableId()) even though Jellite
  // has no separate album/artist entities — fall back to any track's embedded cover that
  // matches that album or artist name.
  const albumOrArtistTrack = getTrackByAlbumOrArtistStableId(stableId, req.params.id);
  if (albumOrArtistTrack) {
    sendCover(res, albumOrArtistTrack.cover_thumbnail);
    return;
  }

  res.status(404).json({ error: "Not found" });
});
