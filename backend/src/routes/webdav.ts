import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "../auth.js";
import { getAllTrackPaths } from "../db.js";
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
}

/** Lists the immediate children (folders + files) directly under `prefix` ("" = root). */
function listChildren(prefix: string): DirEntry[] {
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

function propResponseXml(path: string, displayName: string, entry: { isCollection: boolean; track?: TrackPathRow }): string {
  const href = encodeHref(path, entry.isCollection);
  const extraProps = !entry.isCollection && entry.track
    ? `<D:getcontentlength>${entry.track.file_size ?? 0}</D:getcontentlength>` +
      `<D:getcontenttype>${contentTypeFor(entry.track)}</D:getcontenttype>` +
      `<D:getlastmodified>${new Date(entry.track.updated_at).toUTCString()}</D:getlastmodified>`
    : "";
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

  const track = path !== "" ? findTrack(path) : undefined;
  let body: string;
  if (track) {
    body = propResponseXml(path, path.split("/").pop() ?? path, { isCollection: false, track });
  } else {
    const children = listChildren(path);
    if (path !== "" && children.length === 0) {
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
