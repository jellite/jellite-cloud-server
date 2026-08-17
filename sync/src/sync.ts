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
import { coverObjectName, createStorage, uploadCover } from "./gcs.js";
import type { ImageHosting } from "./imageHosting.js";

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
  imageHosting: ImageHosting;
  gcsBucketName?: string;
  gcsCoversPrefix?: string;
  googleApplicationCredentials?: string;
  /** Skips Drive uploads (useful for local testing without real GCP credentials). */
  dryRun?: boolean;
}

export interface SyncResult {
  newTracks: number;
  updatedPlaylists: number;
  orphanedTracks: string[];
  durationMs: number;
}

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function imageStorageMatches(
  existing: { cover_thumbnail: Buffer | null; cover_object?: string | null } | undefined,
  imageHosting: ImageHosting
): boolean {
  if (!existing) return false;

  // A null/null row means the source file has no embedded cover and is valid in either mode.
  if (!existing.cover_thumbnail && !existing.cover_object) return true;
  return imageHosting === "sqlite" ? !existing.cover_object : Boolean(existing.cover_object);
}

/**
 * Prints a running "[i/total] NN%" progress indicator to stdout. When stdout is a TTY the
 * line is overwritten in place (via `\r`); otherwise (e.g. piped to a log file on a
 * headless server/cron job) plain lines are printed instead, throttled so routine
 * "unchanged" ticks don't flood the log — uploads and warnings always print immediately.
 */
class ProgressReporter {
  private lastPrintAt = 0;

  constructor(
    private readonly total: number,
    private readonly isTTY: boolean
  ) {}

  update(index: number, message: string, force = false): void {
    const now = Date.now();
    const isLast = index >= this.total;
    if (!force && !isLast) {
      if (this.isTTY && now - this.lastPrintAt < 150) return;
      if (!this.isTTY && index % 25 !== 0) return;
    }
    this.lastPrintAt = now;

    const pct = this.total > 0 ? Math.round((index / this.total) * 100) : 100;
    const line = `[${index}/${this.total}] ${pct}% ${message}`;
    if (this.isTTY) {
      process.stdout.write(`\r\x1b[K${line}`);
      if (isLast) process.stdout.write("\n");
    } else {
      console.log(line);
    }
  }
}

/**
 * Runs one full sync pass: scans every `.m3u` file in `playlistsDir`, uploads any new/changed
 * audio files they reference to Drive (only files that are on at least one playlist — the
 * library folder itself is never scanned wholesale), rebuilds playlist definitions, and
 * reports (without deleting) tracks that are no longer referenced by any playlist. See
 * docs/SPEC.md section 5.
 */
export async function runSync(options: SyncOptions): Promise<SyncResult> {
  const startedAt = Date.now();
  if (!options.dryRun && !options.oauthTokenFilePath) {
    throw new Error(
      "Missing --oauth-token-file (required unless --dry-run). Run the one-time authorization first: see sync/README.md."
    );
  }

  const db = openSyncDb(options.dbPath);
  const drive = options.dryRun ? undefined : await createOAuthDriveClient(options.oauthTokenFilePath!);
  const storage = options.imageHosting === "gcs" && !options.dryRun
    ? createStorage(options.googleApplicationCredentials)
    : undefined;
  if (options.imageHosting === "gcs" && !options.dryRun && !options.gcsBucketName) {
    throw new Error("gcsBucketName is required when imageHosting is gcs");
  }

  upsertUser(db, options.username, options.userId);

  console.log(`Scanning playlists in ${options.playlistsDir} ...`);
  const playlists = await parsePlaylistsDir(options.playlistsDir, options.libraryRoot);
  const referencedPaths = new Set<string>();
  for (const playlist of playlists) {
    for (const path of playlist.trackPaths) referencedPaths.add(path);
  }
  const pathsToProcess = [...referencedPaths];
  console.log(
    `Found ${playlists.length} playlist(s) referencing ${pathsToProcess.length} unique track(s).`
  );

  const existingPaths = getAllTrackPaths(db);
  const progress = new ProgressReporter(pathsToProcess.length, process.stdout.isTTY === true);

  let newTracks = 0;
  let unchangedTracks = 0;
  let missingTracks = 0;
  for (let i = 0; i < pathsToProcess.length; i++) {
    const relativePath = pathsToProcess[i];
    const index = i + 1;
    const absolutePath = resolve(options.libraryRoot, relativePath);
    if (!existsSync(absolutePath)) {
      missingTracks += 1;
      console.warn(`Skipping missing file referenced by a playlist: ${relativePath}`);
      progress.update(index, `missing: ${relativePath}`, true);
      continue;
    }

    const fileSize = statSync(absolutePath).size;
    const existing = getExistingTrackByPath(db, relativePath);
    if (existing && existing.file_size === fileSize && imageStorageMatches(existing, options.imageHosting)) {
      unchangedTracks += 1;
      progress.update(index, `up to date (${unchangedTracks} so far)`);
      continue; // unchanged, nothing to do
    }

    const uploadStartedAt = Date.now();
    progress.update(index, `uploading "${basename(absolutePath)}" (${formatBytes(fileSize)})...`, true);

    const metadata = await extractMetadata(absolutePath, options.imageHosting);
    const driveFileId =
      existing?.drive_file_id ??
      (drive ? await uploadAudioFile(drive, absolutePath, basename(absolutePath), options.driveFolderId) : "DRY_RUN");
    const id = existing?.id ?? trackId(relativePath);
    if (storage && options.gcsBucketName && metadata.coverWebp) {
      await uploadCover(
        storage,
        options.gcsBucketName,
        coverObjectName(id, options.gcsCoversPrefix),
        metadata.coverWebp
      );
    }

    upsertTrack(db, {
      id,
      relativePath,
      driveFileId,
      title: metadata.title,
      artist: metadata.artist,
      album: metadata.album,
      durationMs: metadata.durationMs,
      container: absolutePath.toLowerCase().endsWith(".flac") ? "flac" : "m4a",
      fileSize,
      coverThumbnail: options.imageHosting === "sqlite" ? metadata.coverThumbnail : null,
      coverObject:
        options.imageHosting === "gcs" && storage && options.gcsBucketName && metadata.coverWebp
          ? coverObjectName(id, options.gcsCoversPrefix)
          : null,
    });
    newTracks += 1;
    existingPaths.add(relativePath);
    progress.update(
      index,
      `uploaded "${basename(absolutePath)}" in ${formatDuration(Date.now() - uploadStartedAt)}`,
      true
    );
  }
  console.log(
    `Processed ${pathsToProcess.length} referenced track(s) in ${formatDuration(Date.now() - startedAt)}: ` +
      `${newTracks} uploaded, ${unchangedTracks} unchanged, ${missingTracks} missing.`
  );

  console.log(`Rebuilding ${playlists.length} playlist(s)...`);
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

  // Checkpoint WAL into the main DB file so data/jellite.sqlite is immediately consistent
  // and ready to commit/deploy without a separate manual step (WAL mode otherwise leaves
  // recent writes only in the -wal sidecar file, which is gitignored and not deployed).
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
  const durationMs = Date.now() - startedAt;
  console.log(`Sync finished in ${formatDuration(durationMs)}.`);
  return { newTracks, updatedPlaylists: playlists.length, orphanedTracks, durationMs };
}
