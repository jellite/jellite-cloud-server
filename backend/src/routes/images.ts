import { Router } from "express";
import { config } from "../config.js";
import { getPlaylistByExternalId, getPlaylistPrimaryTrack, getPlaylists, getTrack, getTrackByAlbumOrArtistStableId } from "../db.js";
import type { TrackRow } from "../db.js";
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

function gcsCoverUrl(objectName: string): string {
  const baseUrl = config.gcsPublicBaseUrl ??
    `https://storage.googleapis.com/${encodeURIComponent(config.gcsBucketName!)}`;
  const encodedObjectName = objectName.split("/").map(encodeURIComponent).join("/");
  return `${baseUrl.replace(/\/+$/, "")}/${encodedObjectName}`;
}

function gcsCoverObject(track: TrackRow): string | undefined {
  return track.cover_object ?? undefined;
}

function sendTrackCover(res: import("express").Response, track: TrackRow | undefined): void {
  if (!track) {
    res.status(404).json({ error: "No image" });
    return;
  }

  if (config.imageHosting === "sqlite") {
    sendCover(res, track.cover_thumbnail);
    return;
  }

  const objectName = gcsCoverObject(track);
  if (!objectName) {
    res.status(404).json({ error: "No image" });
    return;
  }
  res.setHeader("Cache-Control", "public, max-age=604800");
  res.redirect(302, gcsCoverUrl(objectName));
}

// Track cover art, extracted from embedded FLAC/M4A tags during sync (see SPEC.md).
imagesRouter.get("/Items/:id/Images/Primary", (req, res) => {
  const track = getTrack(req.params.id);
  if (track) {
    sendTrackCover(res, track);
    return;
  }

  // Playlist cover art = cover of its first track (see SPEC.md), resolved on demand so we
  // don't need to duplicate image bytes per playlist in the DB. Playlist ids exposed to
  // clients are MD5 hashes of the real slug (see jellyfinShapes.ts externalPlaylistId),
  // so reverse-resolve before looking it up.
  const playlist = getPlaylistByExternalId(externalPlaylistId, req.params.id);
  if (playlist) {
    const firstTrack = getPlaylistPrimaryTrack(playlist.id);
    sendTrackCover(res, firstTrack);
    return;
  }

  // The fake "Music" library itself (see musicLibraryItem()) has no cover of its own —
  // fall back to the first playlist's cover so clients like jellyfin-vue don't just show
  // a broken image/404 for the library tile.
  if (req.params.id === MUSIC_LIBRARY_ID) {
    const firstPlaylist = getPlaylists()[0];
    const firstTrack = firstPlaylist ? getPlaylistPrimaryTrack(firstPlaylist.id) : undefined;
    sendTrackCover(res, firstTrack);
    return;
  }

  // Clients also request cover art for the synthetic album/artist ids embedded in track
  // metadata (AlbumId/ArtistItems, see jellyfinShapes.ts stableId()) even though Jellite
  // has no separate album/artist entities — fall back to any track's embedded cover that
  // matches that album or artist name.
  const albumOrArtistTrack = getTrackByAlbumOrArtistStableId(stableId, req.params.id);
  if (albumOrArtistTrack) {
    sendTrackCover(res, albumOrArtistTrack);
    return;
  }

  res.status(404).json({ error: "Not found" });
});
