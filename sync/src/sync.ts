import { existsSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  getAllTrackPaths,
  getExistingTrackByPath,
  openSyncDb,
  replacePlaylistTracks,
  upsertPlaylist,
  upsertTrack,
  upsertUser,
} from "./db.js";
import { createOAuthDriveClient, uploadAudioFile } from "./drive.js";
import { trackId, playlistId } from "./ids.js";
import { extractMetadata } from "./metadata.js";
import { parsePlaylistsDir } from "./parseM3u.js";

export interface SyncOptions {
  libraryRoot: string;
  playlistsDir: string;
  dbPath: string;
  driveFolderId: string;
  /**
   * Path to the OAuth token file produced by the one-time `authorize` flow (see
   * sync/src/authorize.ts and sync/README.md). Uploads run as the actual Google account
   * that owns the Drive folder, since service accounts have no storage quota of their own.
   */
  oauthTokenFilePath?: string;
  username: string;
  userId: string;
  /** Skips Drive uploads (useful for local testing without real GCP credentials). */
  dryRun?: boolean;
}

export interface SyncResult {
  newTracks: number;
  updatedPlaylists: number;
  orphanedTracks: string[];
}

/**
 * Runs one full sync pass: scans every `.m3u` file in `playlistsDir`, uploads any new/changed
 * audio files they reference to Drive (only files that are on at least one playlist — the
 * library folder itself is never scanned wholesale), rebuilds playlist definitions, and
 * reports (without deleting) tracks that are no longer referenced by any playlist. See
 * docs/SPEC.md section 5.
 */
export async function runSync(options: SyncOptions): Promise<SyncResult> {
  if (!options.dryRun && !options.oauthTokenFilePath) {
    throw new Error(
      "Missing --oauth-token-file (required unless --dry-run). Run the one-time authorization first: see sync/README.md."
    );
  }

  const db = openSyncDb(options.dbPath);
  const drive = options.dryRun ? undefined : await createOAuthDriveClient(options.oauthTokenFilePath!);

  upsertUser(db, options.username, options.userId);

  const playlists = await parsePlaylistsDir(options.playlistsDir, options.libraryRoot);
  const referencedPaths = new Set<string>();
  for (const playlist of playlists) {
    for (const path of playlist.trackPaths) referencedPaths.add(path);
  }

  const existingPaths = getAllTrackPaths(db);

  let newTracks = 0;
  for (const relativePath of referencedPaths) {
    const absolutePath = resolve(options.libraryRoot, relativePath);
    if (!existsSync(absolutePath)) {
      console.warn(`Skipping missing file referenced by a playlist: ${relativePath}`);
      continue;
    }

    const fileSize = statSync(absolutePath).size;
    const existing = getExistingTrackByPath(db, relativePath);
    if (existing && existing.file_size === fileSize) {
      continue; // unchanged, nothing to do
    }

    const metadata = await extractMetadata(absolutePath);
    const driveFileId =
      existing?.drive_file_id ??
      (drive ? await uploadAudioFile(drive, absolutePath, basename(absolutePath), options.driveFolderId) : "DRY_RUN");

    upsertTrack(db, {
      id: existing?.id ?? trackId(relativePath),
      relativePath,
      driveFileId,
      title: metadata.title,
      artist: metadata.artist,
      album: metadata.album,
      durationMs: metadata.durationMs,
      container: absolutePath.toLowerCase().endsWith(".flac") ? "flac" : "m4a",
      fileSize,
      coverThumbnail: metadata.coverThumbnail,
    });
    newTracks += 1;
    existingPaths.add(relativePath);
  }

  for (const playlist of playlists) {
    const id = playlistId(playlist.name);
    upsertPlaylist(db, id, playlist.name);

    const trackIds = playlist.trackPaths
      .map((path) => {
        const existing = getExistingTrackByPath(db, path);
        if (!existing) {
          console.warn(`Playlist "${playlist.name}" references unknown track: ${path}`);
        }
        return existing?.id;
      })
      .filter((id): id is string => Boolean(id));

    replacePlaylistTracks(db, id, trackIds);
  }

  const orphanedTracks = [...existingPaths].filter((path) => !referencedPaths.has(path));
  if (orphanedTracks.length > 0) {
    console.warn(
      `${orphanedTracks.length} track(s) are in the DB but no longer referenced by any playlist (not deleted automatically):`,
      orphanedTracks
    );
  }

  db.close();
  return { newTracks, updatedPlaylists: playlists.length, orphanedTracks };
}
