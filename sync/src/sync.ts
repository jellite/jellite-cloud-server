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
import { createDriveClient, uploadAudioFile } from "./drive.js";
import { trackId, playlistId } from "./ids.js";
import { extractMetadata } from "./metadata.js";
import { parseMasterList } from "./parseMasterList.js";
import { parsePlaylistsDir } from "./parseM3u.js";

export interface SyncOptions {
  libraryRoot: string;
  masterListPath: string;
  playlistsDir: string;
  dbPath: string;
  driveFolderId: string;
  keyFilePath?: string;
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
 * Runs one full sync pass: uploads new/changed audio files to the Shared Drive, rebuilds
 * playlist definitions from `.m3u` files, and reports (without deleting) tracks that are
 * no longer referenced by the master list. See docs/SPEC.md section 5.
 */
export async function runSync(options: SyncOptions): Promise<SyncResult> {
  const db = openSyncDb(options.dbPath);
  const drive = options.dryRun ? undefined : createDriveClient(options.keyFilePath);

  upsertUser(db, options.username, options.userId);

  const masterPaths = await parseMasterList(options.masterListPath);
  const existingPaths = getAllTrackPaths(db);

  let newTracks = 0;
  for (const relativePath of masterPaths) {
    const absolutePath = resolve(options.libraryRoot, relativePath);
    if (!existsSync(absolutePath)) {
      console.warn(`Skipping missing file referenced by master list: ${relativePath}`);
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

  const playlists = await parsePlaylistsDir(options.playlistsDir);
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

  const masterSet = new Set(masterPaths);
  const orphanedTracks = [...existingPaths].filter((path) => !masterSet.has(path));
  if (orphanedTracks.length > 0) {
    console.warn(
      `${orphanedTracks.length} track(s) are in the DB but no longer in the master list (not deleted automatically):`,
      orphanedTracks
    );
  }

  db.close();
  return { newTracks, updatedPlaylists: playlists.length, orphanedTracks };
}
