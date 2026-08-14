import Database from "better-sqlite3";

export interface TrackUpsert {
  id: string;
  relativePath: string;
  driveFileId: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  durationMs: number | null;
  container: string | null;
  fileSize: number;
  coverThumbnail: Buffer | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tracks (
  id              TEXT PRIMARY KEY,
  relative_path   TEXT NOT NULL UNIQUE,
  drive_file_id   TEXT NOT NULL,
  title           TEXT,
  artist          TEXT,
  album           TEXT,
  duration_ms     INTEGER,
  container       TEXT,
  file_size       INTEGER,
  cover_thumbnail BLOB,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playlists (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  playlist_id TEXT NOT NULL REFERENCES playlists(id),
  track_id    TEXT NOT NULL REFERENCES tracks(id),
  position    INTEGER NOT NULL,
  PRIMARY KEY (playlist_id, position)
);

CREATE TABLE IF NOT EXISTS users (
  id               TEXT PRIMARY KEY,
  username         TEXT NOT NULL UNIQUE,
  jellyfin_user_id TEXT NOT NULL UNIQUE
);
`;

export function openSyncDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

export function getExistingTrackByPath(db: Database.Database, relativePath: string) {
  return db.prepare("SELECT * FROM tracks WHERE relative_path = ?").get(relativePath) as
    | { id: string; file_size: number | null; drive_file_id: string }
    | undefined;
}

export function upsertTrack(db: Database.Database, track: TrackUpsert): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO tracks (id, relative_path, drive_file_id, title, artist, album, duration_ms, container, file_size, cover_thumbnail, created_at, updated_at)
     VALUES (@id, @relativePath, @driveFileId, @title, @artist, @album, @durationMs, @container, @fileSize, @coverThumbnail, @now, @now)
     ON CONFLICT(relative_path) DO UPDATE SET
       drive_file_id = excluded.drive_file_id,
       title = excluded.title,
       artist = excluded.artist,
       album = excluded.album,
       duration_ms = excluded.duration_ms,
       container = excluded.container,
       file_size = excluded.file_size,
       cover_thumbnail = excluded.cover_thumbnail,
       updated_at = excluded.updated_at`
  ).run({ ...track, now });
}

export function upsertPlaylist(db: Database.Database, id: string, name: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO playlists (id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`
  ).run(id, name, now, now);
}

export function replacePlaylistTracks(db: Database.Database, playlistId: string, trackIds: string[]): void {
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM playlist_tracks WHERE playlist_id = ?").run(playlistId);
    const insert = db.prepare(
      "INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)"
    );
    trackIds.forEach((trackId, index) => insert.run(playlistId, trackId, index));
  });
  tx();
}

export function upsertUser(db: Database.Database, username: string, jellyfinUserId: string): void {
  db.prepare(
    `INSERT INTO users (id, username, jellyfin_user_id)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET username = excluded.username, jellyfin_user_id = excluded.jellyfin_user_id`
  ).run(jellyfinUserId, username, jellyfinUserId);
}

export function getAllTrackPaths(db: Database.Database): Set<string> {
  const rows = db.prepare("SELECT relative_path FROM tracks").all() as { relative_path: string }[];
  return new Set(rows.map((r) => r.relative_path));
}
