import Database from "better-sqlite3";
import { config } from "./config.js";

export interface TrackRow {
  id: string;
  relative_path: string;
  drive_file_id: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  duration_ms: number | null;
  container: string | null;
  file_size: number | null;
  cover_thumbnail: Buffer | null;
  cover_object?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlaylistRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

// The DB is produced offline by the sync script and baked into the container image at
// deploy time, so the backend only ever needs read-only access to it.
export const db = new Database(config.dbPath, { readonly: true, fileMustExist: true });
db.pragma("journal_mode = WAL");

const trackColumns = db.pragma("table_info(tracks)") as { name: string }[];
const hasCoverObjectColumn = trackColumns.some((column) => column.name === "cover_object");

function trackProjection(tableAlias = ""): string {
  if (config.imageHosting !== "gcs") return `${tableAlias}*`;

  // Do not pull legacy JPEG BLOBs into Node when GCS is active. Run export-covers first for
  // databases created before the cover_object column was added.
  const column = (name: string) => `${tableAlias}${name}`;
  return [
    column("id"),
    column("relative_path"),
    column("drive_file_id"),
    column("title"),
    column("artist"),
    column("album"),
    column("duration_ms"),
    column("container"),
    column("file_size"),
    "NULL AS cover_thumbnail",
    hasCoverObjectColumn ? column("cover_object") : "NULL AS cover_object",
    column("created_at"),
    column("updated_at"),
  ].join(", ");
}

export function getPlaylists(): PlaylistRow[] {
  return db.prepare("SELECT * FROM playlists ORDER BY name COLLATE NOCASE").all() as PlaylistRow[];
}

export function getPlaylist(id: string): PlaylistRow | undefined {
  return db.prepare("SELECT * FROM playlists WHERE id = ?").get(id) as PlaylistRow | undefined;
}

export function getPlaylistTracks(playlistId: string): TrackRow[] {
  return db
    .prepare(
      `SELECT ${trackProjection("t.")} FROM playlist_tracks pt
       JOIN tracks t ON t.id = pt.track_id
       WHERE pt.playlist_id = ?
       ORDER BY pt.position ASC`
    )
    .all(playlistId) as TrackRow[];
}

export function getPlaylistPrimaryTrack(playlistId: string): TrackRow | undefined {
  return db
    .prepare(
      `SELECT ${trackProjection("t.")} FROM playlist_tracks pt
       JOIN tracks t ON t.id = pt.track_id
       WHERE pt.playlist_id = ?
       ORDER BY pt.position ASC
       LIMIT 1`
    )
    .get(playlistId) as TrackRow | undefined;
}

export function getTrack(id: string): TrackRow | undefined {
  return db.prepare(`SELECT ${trackProjection()} FROM tracks WHERE id = ?`).get(id) as TrackRow | undefined;
}

export interface TrackPathRow {
  id: string;
  relative_path: string;
  drive_file_id: string;
  file_size: number | null;
  container: string | null;
  updated_at: string;
}

let cachedTrackPaths: TrackPathRow[] | undefined;

/**
 * Lightweight projection of every track's path, used by the WebDAV browser (see
 * routes/webdav.ts) to build directory listings for arbitrary path prefixes without a
 * dedicated folder table. Loaded once and cached in memory: the DB is read-only and baked
 * into the image at deploy time (see the comment on `db` above), so it can't change under
 * us during the process lifetime, and the full track list is small enough to hold in RAM.
 */
export function getAllTrackPaths(): TrackPathRow[] {
  if (!cachedTrackPaths) {
    cachedTrackPaths = db
      .prepare("SELECT id, relative_path, drive_file_id, file_size, container, updated_at FROM tracks")
      .all() as TrackPathRow[];
  }
  return cachedTrackPaths;
}

/**
 * Jellite exposes stable, deterministic ids for album/artist "entities" (see
 * jellyfinShapes.ts stableId()) even though they have no real row of their own — clients
 * then request cover art via /Items/{albumOrArtistId}/Images/Primary for those ids. Since
 * we don't persist a separate album/artist table, resolve this by scanning tracks for a
 * matching album/artist name (hashed the same way) and reusing its embedded cover.
 */
export function getTrackByAlbumOrArtistStableId(
  stableId: (value: string) => string,
  id: string
): TrackRow | undefined {
  const coverFilter = config.imageHosting === "gcs"
    ? (hasCoverObjectColumn ? "cover_object IS NOT NULL" : "0")
    : "cover_thumbnail IS NOT NULL";
  const tracks = db.prepare(`SELECT ${trackProjection()} FROM tracks WHERE ${coverFilter}`).all() as TrackRow[];
  for (const track of tracks) {
    if (track.album && stableId(track.album) === id) return track;
    if (track.artist && stableId(track.artist) === id) return track;
  }
  return undefined;
}

/**
 * Playlist ids in the DB are human-readable slugs (e.g. "deezer", "jan"), but
 * jellyfin-vue's router guard rejects any /library|playlist/{itemId} route param that
 * isn't a 32-char hex string (see jellyfinShapes.ts MUSIC_LIBRARY_ID comment) — so we
 * expose an MD5 hash of the slug to clients instead, and reverse-resolve it back to the
 * real playlist here (cheap: at most a few dozen playlists, see SPEC.md).
 */
export function getPlaylistByExternalId(
  externalId: (id: string) => string,
  id: string
): PlaylistRow | undefined {
  return getPlaylists().find((playlist) => externalId(playlist.id) === id);
}
