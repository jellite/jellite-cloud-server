import Database from "better-sqlite3";
import { createServiceAccountDriveClient } from "./drive.js";

interface TrackCheckRow {
  id: string;
  relative_path: string;
  drive_file_id: string;
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

/**
 * Diagnostic script: verifies that every `tracks.drive_file_id` in the local SQLite DB
 * still resolves to an actual, readable file on Google Drive (via the service account,
 * same credentials/access path the backend uses to stream audio — see
 * backend/src/driveClient.ts). Useful after manual cleanup/reorganization on Drive, or to
 * find out why some tracks in a playlist fail to play/download.
 *
 * Usage:
 *   npm run check-drive --workspace sync -- --db ../data/jellite.sqlite [--key-file ./service-account.json] [--concurrency 8]
 *
 * Exit code is 1 if any track is missing/inaccessible, so this can be wired into CI/cron.
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = typeof args["db"] === "string" ? args["db"] : "./data/jellite.sqlite";
  const keyFile = typeof args["key-file"] === "string" ? args["key-file"] : process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const concurrency = typeof args["concurrency"] === "string" ? Number(args["concurrency"]) : 8;

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const tracks = db.prepare("SELECT id, relative_path, drive_file_id FROM tracks ORDER BY relative_path").all() as
    TrackCheckRow[];
  db.close();

  console.log(`Checking ${tracks.length} track(s) from ${dbPath} against Google Drive...`);
  const drive = createServiceAccountDriveClient(keyFile);

  const missing: TrackCheckRow[] = [];
  const errors: { track: TrackCheckRow; message: string }[] = [];
  let checked = 0;

  // Simple bounded-concurrency worker pool: Drive API has per-user rate limits, so we
  // avoid firing off hundreds of requests all at once while still going faster than a
  // fully sequential loop.
  async function worker() {
    while (true) {
      const track = tracks[checked];
      if (!track) return;
      checked += 1;
      const index = checked;
      try {
        const meta = await drive.files.get({
          fileId: track.drive_file_id,
          fields: "id, trashed",
          supportsAllDrives: true,
        });
        if (meta.data.trashed) {
          missing.push(track);
          console.warn(`[${index}/${tracks.length}] TRASHED: ${track.relative_path} (${track.drive_file_id})`);
        } else if (index % 25 === 0 || index === tracks.length) {
          console.log(`[${index}/${tracks.length}] checked...`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const notFound = message.includes("404") || message.toLowerCase().includes("not found");
        if (notFound) {
          missing.push(track);
          console.warn(`[${index}/${tracks.length}] MISSING: ${track.relative_path} (${track.drive_file_id})`);
        } else {
          errors.push({ track, message });
          console.error(`[${index}/${tracks.length}] ERROR checking ${track.relative_path}: ${message}`);
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));

  console.log("\n--- Summary ---");
  console.log(`Total tracks checked: ${tracks.length}`);
  console.log(`Missing/trashed on Drive: ${missing.length}`);
  console.log(`Errors (non-404, e.g. permission issues): ${errors.length}`);

  if (missing.length > 0) {
    console.log("\nMissing/trashed tracks:");
    for (const track of missing) {
      console.log(`  - ${track.relative_path} (id=${track.id}, drive_file_id=${track.drive_file_id})`);
    }
  }
  if (errors.length > 0) {
    console.log("\nTracks with errors (check service account permissions/Drive folder sharing):");
    for (const { track, message } of errors) {
      console.log(`  - ${track.relative_path} (drive_file_id=${track.drive_file_id}): ${message}`);
    }
  }

  if (missing.length > 0 || errors.length > 0) {
    process.exitCode = 1;
  } else {
    console.log("\nAll tracks are present and accessible on Google Drive.");
  }
}

main().catch((err) => {
  console.error("check-drive-files failed:", err);
  process.exitCode = 1;
});
