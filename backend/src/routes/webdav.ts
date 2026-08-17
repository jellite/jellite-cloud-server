import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "../auth.js";
import { getAllTrackPaths, getPlaylistTracks, getPlaylists } from "../db.js";
import type { TrackPathRow } from "../db.js";
import { streamDriveFile } from "../driveClient.js";

/**
 * Real, read-only WebDAV access to the music library (Artist/Album/Track hierarchy
 * mirroring `tracks.relative_path`), mounted at `/webdav` alongside the Jellyfin-shaped
 * API. This is for clients like foobar2000 that can use a WebDAV share directly (as an
 * alternative/addition to the Jellyfin API) — see docs/SPEC.md. There's no separate
 * "folder" table: directory listings are derived on the fly from the flat track path list
 * (see db.ts getAllTrackPaths()), since the library is small enough for that to be cheap.
 */
export const webdavRouter = Router();

const MIME_BY_CONTAINER: Record<string, string> = {
  flac: "audio/flac",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  opus: "audio/opus",
  wav: "audio/wav",
  alac: "audio/mp4",
};

const PLAYLISTS_DIR = "playlists";
const PLAYLIST_EXTENSION = ".m3u";
const PLAYLIST_MIME_TYPE = "audio/x-mpegurl; charset=utf-8";

function contentTypeFor(track: TrackPathRow): string {
  const container = track.container?.toLowerCase();
  return (container && MIME_BY_CONTAINER[container]) ?? "application/octet-stream";
}

function xmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&apos;";
    }
  });
}

/**
 * `req.path` is still percent-encoded at this point (Express only decodes it for route
 * param matching, not for `req.path` itself) — decode it and strip slashes so it matches
 * the raw, unencoded style of `relative_path` in the DB (e.g. "Artist/AbradAb/Album/x.flac").
 */
function normalizePath(rawPath: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    decoded = rawPath;
  }
  return decoded.replace(/^\/+/, "").replace(/\/+$/, "");
}

interface DirEntry {
  name: string;
  isCollection: boolean;
  track?: TrackPathRow;
  contentType?: string;
  contentLength?: number;
  updatedAt?: string;
}

/** Lists the immediate children (folders + files) directly under `prefix` ("" = root). */
function listChildren(prefix: string): DirEntry[] {
  if (prefix === PLAYLISTS_DIR) {
    return getPlaylists().map((playlist) => {
      const content = buildPlaylistM3u(playlist.id);
      return {
        name: `${playlist.name}${PLAYLIST_EXTENSION}`,
        isCollection: false,
        contentType: PLAYLIST_MIME_TYPE,
        contentLength: Buffer.byteLength(content),
        updatedAt: playlist.updated_at,
      };
    });
  }

  const prefixLen = prefix === "" ? 0 : prefix.length + 1;
  const folders = new Set<string>();
  const files: DirEntry[] = [];
  for (const track of getAllTrackPaths()) {
    if (prefix !== "" && !track.relative_path.startsWith(`${prefix}/`)) continue;
    const rest = track.relative_path.slice(prefixLen);
    const slashIndex = rest.indexOf("/");
    if (slashIndex === -1) {
      files.push({ name: rest, isCollection: false, track });
    } else {
      folders.add(rest.slice(0, slashIndex));
    }
  }
  if (prefix === "") folders.add(PLAYLISTS_DIR);
  const folderEntries: DirEntry[] = [...folders].sort().map((name) => ({ name, isCollection: true }));
  return [...folderEntries, ...files];
}

function findTrack(path: string): TrackPathRow | undefined {
  return getAllTrackPaths().find((track) => track.relative_path === path);
}

/** Percent-encodes each path segment individually so unicode names round-trip in `<D:href>`. */
function encodeHref(path: string, trailingSlash: boolean): string {
  const segments = path === "" ? [] : path.split("/").map(encodeURIComponent);
  return `/webdav/${segments.join("/")}${trailingSlash ? "/" : ""}`.replace(/\/{2,}/g, "/");
}

function fileNameWithoutExtension(relativePath: string): string {
  const fileName = relativePath.split("/").pop() ?? relativePath;
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
}

function extinfDisplayName(track: { artist: string | null; title: string | null; relative_path: string }): string {
  const artist = track.artist?.trim();
  const title = track.title?.trim();
  if (artist && title) return `${artist} - ${title}`;
  if (title) return title;
  return fileNameWithoutExtension(track.relative_path);
}

function buildPlaylistM3u(playlistId: string): string {
  const lines = getPlaylistTracks(playlistId).flatMap((track) => {
    const durationSec = track.duration_ms != null ? Math.max(0, Math.floor(track.duration_ms / 1000)) : -1;
    const name = extinfDisplayName(track).replace(/\r?\n/g, " ");
    return [`#EXTINF:${durationSec},${name}`, `../${track.relative_path}`];
  });
  return `#EXTM3U\n${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`;
}

function findPlaylistM3u(path: string):
  | { content: string; updatedAt: string; contentLength: number; contentType: string }
  | undefined {
  if (!path.startsWith(`${PLAYLISTS_DIR}/`)) return undefined;
  const rest = path.slice(`${PLAYLISTS_DIR}/`.length);
  if (rest.includes("/") || !rest.toLowerCase().endsWith(PLAYLIST_EXTENSION)) return undefined;

  const playlistName = rest.slice(0, -PLAYLIST_EXTENSION.length);
  const playlist = getPlaylists().find((candidate) => candidate.name === playlistName);
  if (!playlist) return undefined;

  const content = buildPlaylistM3u(playlist.id);
  return {
    content,
    updatedAt: playlist.updated_at,
    contentLength: Buffer.byteLength(content),
    contentType: PLAYLIST_MIME_TYPE,
  };
}

function propResponseXml(
  path: string,
  displayName: string,
  entry: { isCollection: boolean; track?: TrackPathRow; contentType?: string; contentLength?: number; updatedAt?: string }
): string {
  const href = encodeHref(path, entry.isCollection);
  const contentLength = entry.track?.file_size ?? entry.contentLength;
  const contentType = entry.track ? contentTypeFor(entry.track) : entry.contentType;
  const updatedAt = entry.track?.updated_at ?? entry.updatedAt;
  const extraProps = entry.isCollection
    ? ""
    : `<D:getcontentlength>${contentLength ?? 0}</D:getcontentlength>` +
      `<D:getcontenttype>${contentType ?? "application/octet-stream"}</D:getcontenttype>` +
      `<D:getlastmodified>${new Date(updatedAt ?? 0).toUTCString()}</D:getlastmodified>`;
  return (
    "<D:response>" +
    `<D:href>${xmlEscape(href)}</D:href>` +
    "<D:propstat><D:prop>" +
    `<D:displayname>${xmlEscape(displayName)}</D:displayname>` +
    `<D:resourcetype>${entry.isCollection ? "<D:collection/>" : ""}</D:resourcetype>` +
    extraProps +
    "</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>" +
    "</D:response>"
  );
}

// Capability discovery: WebDAV clients (and some, like foobar2000, speculatively) send
// OPTIONS before authenticating to check the server supports WebDAV at all. Left
// unauthenticated on purpose, like real WebDAV servers — it reveals no library data.
webdavRouter.options("*", (_req, res) => {
  res
    .status(200)
    .set({ DAV: "1", Allow: "OPTIONS, GET, HEAD, PROPFIND", "MS-Author-Via": "DAV" })
    .end();
});

webdavRouter.use(requireAuth);

webdavRouter.propfind("*", (req, res) => {
  const path = normalizePath(req.path);
  const depthHeader = req.header("Depth");
  if (depthHeader === "infinity") {
    // Matches common real-world WebDAV server behavior: refuse unbounded recursive
    // listings (RFC 4918 explicitly allows this) rather than walking the whole library.
    res.status(403).send("Infinite Depth PROPFIND is not supported");
    return;
  }
  const includeChildren = depthHeader !== "0";
  const playlistM3u = findPlaylistM3u(path);

  const track = !playlistM3u && path !== "" ? findTrack(path) : undefined;
  let body: string;
  if (playlistM3u) {
    body = propResponseXml(path, path.split("/").pop() ?? path, { isCollection: false, ...playlistM3u });
  } else if (track) {
    body = propResponseXml(path, path.split("/").pop() ?? path, { isCollection: false, track });
  } else {
    const children = listChildren(path);
    const collectionExists = path === "" || path === PLAYLISTS_DIR || children.length > 0;
    if (!collectionExists) {
      res.status(404).end();
      return;
    }
    const selfXml = propResponseXml(path, path === "" ? "webdav" : path.split("/").pop()!, { isCollection: true });
    const childrenXml = includeChildren
      ? children
          .map((entry) => propResponseXml(path === "" ? entry.name : `${path}/${entry.name}`, entry.name, entry))
          .join("")
      : "";
    body = selfXml + childrenXml;
  }

  res
    .status(207)
    .type("application/xml; charset=utf-8")
    .send(`<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">${body}</D:multistatus>`);
});

async function handleGetOrHead(req: Request, res: Response): Promise<void> {
  const path = normalizePath(req.path);
  const playlistM3u = findPlaylistM3u(path);
  if (playlistM3u) {
    if (req.method === "HEAD") {
      res
        .status(200)
        .set({ "Content-Type": playlistM3u.contentType, "Content-Length": String(playlistM3u.contentLength) })
        .end();
      return;
    }

    res
      .status(200)
      .set({ "Content-Type": playlistM3u.contentType, "Content-Length": String(playlistM3u.contentLength) })
      .send(playlistM3u.content);
    return;
  }

  const track = findTrack(path);
  if (!track) {
    res.status(404).end();
    return;
  }

  if (req.method === "HEAD") {
    res.status(200).set({ "Content-Type": contentTypeFor(track), "Accept-Ranges": "bytes" });
    if (track.file_size != null) res.setHeader("Content-Length", String(track.file_size));
    res.end();
    return;
  }

  try {
    await streamDriveFile(track.drive_file_id, req.header("Range"), res);
  } catch (err) {
    if (!res.headersSent) res.status(502).end();
    // eslint-disable-next-line no-console
    console.error(`WebDAV: failed to stream ${track.relative_path} from Drive:`, err);
  }
}

webdavRouter.get("*", handleGetOrHead);
webdavRouter.head("*", handleGetOrHead);
