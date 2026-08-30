import { Router, type Request, type Response } from "express";
import sharp from "sharp";
import { config } from "../config.js";
import { getPlaylistByExternalId, getPlaylistPrimaryTrack, getPlaylists, getTrack, getTrackByAlbumOrArtistStableId } from "../db.js";
import type { TrackRow } from "../db.js";
import { externalPlaylistId, MUSIC_LIBRARY_ID, stableId } from "../jellyfinShapes.js";

export const imagesRouter = Router();
// No requireAuth here: real Jellyfin serves item images without a token, and clients
// rely on that — Finamp's image widgets (e.g. AlbumImageProvider) fetch cover URLs via
// a plain NetworkImage with no Authorization header/query param at all, so requiring
// auth here just made every cover art request fail with 401.

async function sendCover(res: Response, cover: Buffer | null | undefined, format?: string): Promise<void> {
  if (!cover) {
    res.status(404).json({ error: "No image" });
    return;
  }

  const targetFormat = format?.toLowerCase();
  if (targetFormat === "png") {
    const pngBuffer = await sharp(cover).png().toBuffer();
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=604800");
    res.setHeader("Content-Length", pngBuffer.length);
    res.send(pngBuffer);
    return;
  }
  if (targetFormat === "webp") {
    const webpBuffer = await sharp(cover).webp({ quality: 90 }).toBuffer();
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Cache-Control", "public, max-age=604800");
    res.setHeader("Content-Length", webpBuffer.length);
    res.send(webpBuffer);
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

// Proxies (rather than 302-redirects to) the GCS object so the response stays same-origin.
// WebKit/Safari fails to follow a cross-origin redirect when the original request carries
// an `Authorization` header (as Feishin's image fetches do) — the final GCS response's own
// `Access-Control-Allow-Origin` is correct, but WebKit still rejects it as a CORS violation.
// Chromium/Firefox handle this redirect fine, so the bug only reproduces in Safari. Proxying
// avoids the cross-origin hop (and the CORS bucket config) entirely.
async function proxyGcsCover(res: Response, objectName: string, format?: string): Promise<void> {
  try {
    const upstream = await fetch(gcsCoverUrl(objectName));
    if (!upstream.ok || !upstream.body) {
      res.status(404).json({ error: "No image" });
      return;
    }

    const targetFormat = format?.toLowerCase();
    if (targetFormat === "jpg" || targetFormat === "jpeg") {
      const buffer = Buffer.from(await upstream.arrayBuffer());
      const jpegBuffer = await sharp(buffer).jpeg({ quality: 90 }).toBuffer();
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=604800");
      res.setHeader("Content-Length", jpegBuffer.length);
      res.send(jpegBuffer);
      return;
    }

    if (targetFormat === "png") {
      const buffer = Buffer.from(await upstream.arrayBuffer());
      const pngBuffer = await sharp(buffer).png().toBuffer();
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=604800");
      res.setHeader("Content-Length", pngBuffer.length);
      res.send(pngBuffer);
      return;
    }

    res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "image/webp");
    res.setHeader("Cache-Control", "public, max-age=604800");
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) res.setHeader("Content-Length", contentLength);
    const { Readable } = await import("node:stream");
    Readable.fromWeb(upstream.body as import("stream/web").ReadableStream).pipe(res);
  } catch {
    res.status(502).json({ error: "Upstream image fetch failed" });
  }
}

async function sendTrackCover(res: Response, track: TrackRow | undefined, format?: string): Promise<void> {
  if (!track) {
    res.status(404).json({ error: "No image" });
    return;
  }

  if (config.imageHosting === "sqlite") {
    await sendCover(res, track.cover_thumbnail, format);
    return;
  }

  const objectName = gcsCoverObject(track);
  if (!objectName) {
    res.status(404).json({ error: "No image" });
    return;
  }
  await proxyGcsCover(res, objectName, format);
}

function handleImageRequest(req: Request, res: Response): void {
  const format = (req.query.format ?? req.query.Format) as string | undefined;

  const track = getTrack(req.params.id);
  if (track) {
    void sendTrackCover(res, track, format);
    return;
  }

  // Playlist cover art = cover of its first track (see SPEC.md), resolved on demand so we
  // don't need to duplicate image bytes per playlist in the DB. Playlist ids exposed to
  // clients are MD5 hashes of the real slug (see jellyfinShapes.ts externalPlaylistId),
  // so reverse-resolve before looking it up.
  const playlist = getPlaylistByExternalId(externalPlaylistId, req.params.id);
  if (playlist) {
    const firstTrack = getPlaylistPrimaryTrack(playlist.id);
    void sendTrackCover(res, firstTrack, format);
    return;
  }

  // The fake "Music" library itself (see musicLibraryItem()) has no cover of its own —
  // fall back to the first playlist's cover so clients like jellyfin-vue don't just show
  // a broken image/404 for the library tile.
  if (req.params.id === MUSIC_LIBRARY_ID) {
    const firstPlaylist = getPlaylists()[0];
    const firstTrack = firstPlaylist ? getPlaylistPrimaryTrack(firstPlaylist.id) : undefined;
    void sendTrackCover(res, firstTrack, format);
    return;
  }

  // Clients also request cover art for the synthetic album/artist ids embedded in track
  // metadata (AlbumId/ArtistItems, see jellyfinShapes.ts stableId()) even though Jellite
  // has no separate album/artist entities — fall back to any track's embedded cover that
  // matches that album or artist name.
  const albumOrArtistTrack = getTrackByAlbumOrArtistStableId(stableId, req.params.id);
  if (albumOrArtistTrack) {
    void sendTrackCover(res, albumOrArtistTrack, format);
    return;
  }

  res.status(404).json({ error: "Not found" });
}

// Track/Playlist/Artist/Album cover art
imagesRouter.get("/Items/:id/Images/Primary", handleImageRequest);
imagesRouter.get("/Items/:id/Images/Primary/:index", handleImageRequest);
imagesRouter.get("/Items/:id/Images/Thumb", handleImageRequest);
imagesRouter.get("/Items/:id/Images/Backdrop", handleImageRequest);

