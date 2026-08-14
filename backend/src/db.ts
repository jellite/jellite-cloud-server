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

export function getPlaylists(): PlaylistRow[] {
  return db.prepare("SELECT * FROM playlists ORDER BY name COLLATE NOCASE").all() as PlaylistRow[];
}

export function getPlaylist(id: string): PlaylistRow | undefined {
  return db.prepare("SELECT * FROM playlists WHERE id = ?").get(id) as PlaylistRow | undefined;
}

export function getPlaylistTracks(playlistId: string): TrackRow[] {
  return db
    .prepare(
      `SELECT t.* FROM playlist_tracks pt
       JOIN tracks t ON t.id = pt.track_id
       WHERE pt.playlist_id = ?
       ORDER BY pt.position ASC`
    )
    .all(playlistId) as TrackRow[];
}

export function getPlaylistPrimaryTrack(playlistId: string): TrackRow | undefined {
  return db
    .prepare(
      `SELECT t.* FROM playlist_tracks pt
       JOIN tracks t ON t.id = pt.track_id
       WHERE pt.playlist_id = ?
       ORDER BY pt.position ASC
       LIMIT 1`
    )
    .get(playlistId) as TrackRow | undefined;
}

export function getTrack(id: string): TrackRow | undefined {
  return db.prepare("SELECT * FROM tracks WHERE id = ?").get(id) as TrackRow | undefined;
}
