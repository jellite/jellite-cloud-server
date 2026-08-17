import Database from "better-sqlite3";
import sharp from "sharp";
import { resolve } from "node:path";
import { coverObjectName, createStorage, DEFAULT_COVERS_PREFIX, uploadCover } from "./gcs.js";

interface CoverRow {
  id: string;
  cover_thumbnail: Buffer | null;
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

function required(args: Record<string, string | boolean>, name: string, fallback?: string): string {
  const value = args[name] ?? fallback;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing --${name}${fallback ? ` (or ${name.toUpperCase().replace(/-/g, "_")})` : ""}`);
  }
  return value;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = resolve(required(args, "db"));
  const bucketName = required(args, "gcs-bucket", process.env.GCS_BUCKET_NAME);
  const prefix = required(args, "gcs-covers-prefix", process.env.GCS_COVERS_PREFIX ?? DEFAULT_COVERS_PREFIX);
  const keyFilename = typeof args["key-file"] === "string"
    ? resolve(args["key-file"])
    : process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const limit = typeof args.limit === "string" ? Number(args.limit) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error("--limit must be a positive integer");
  }

  const db = new Database(dbPath, { fileMustExist: true });
  db.pragma("journal_mode = WAL");
  const columns = db.prepare("PRAGMA table_info(tracks)").all() as { name: string }[];
  if (!columns.some((column) => column.name === "cover_object")) {
    db.exec("ALTER TABLE tracks ADD COLUMN cover_object TEXT");
  }
  const overwrite = args.overwrite === true;
  const coverWhere = overwrite
    ? "cover_thumbnail IS NOT NULL"
    : "cover_thumbnail IS NOT NULL AND cover_object IS NULL";
  const total = (
    db.prepare(`SELECT COUNT(*) AS count FROM tracks WHERE ${coverWhere}`).get() as { count: number }
  ).count;
  const rows = db.prepare(
    `SELECT id, cover_thumbnail FROM tracks WHERE ${coverWhere} ORDER BY id${limit ? " LIMIT ?" : ""}`
  ).iterate(...(limit ? [limit] : [])) as Iterable<CoverRow>;
  const storage = createStorage(keyFilename);
  const objectPrefix = prefix;
  const stripSqliteCovers = args["strip-sqlite-covers"] === true;
  const uploadedObjects: { id: string; objectName: string }[] = [];

  const expected = limit ? Math.min(limit, total) : total;
  console.log(
    `${overwrite ? "Uploading" : "Uploading pending"} ${expected} SQLite cover(s) to gs://${bucketName}/${prefix}/ as WebP ...`
  );
  let uploaded = 0;
  for (const row of rows) {
    const webp = await sharp(row.cover_thumbnail!).webp({ quality: 80 }).toBuffer();
    const objectName = coverObjectName(row.id, objectPrefix);
    await uploadCover(storage, bucketName, objectName, webp);
    uploadedObjects.push({ id: row.id, objectName });
    uploaded += 1;
    const percent = expected > 0 ? Math.round((uploaded / expected) * 100) : 100;
    const progress = `[${uploaded}/${expected}] ${percent}%`;
    if (process.stdout.isTTY) {
      process.stdout.write(`\r\x1b[K${progress}`);
      if (uploaded === expected) process.stdout.write("\n");
    } else if (uploaded % 100 === 0 || uploaded === expected) {
      console.log(progress);
    }
  }
  const updateObjects = db.transaction(() => {
    const updateObject = db.prepare(
      stripSqliteCovers
        ? "UPDATE tracks SET cover_object = ?, cover_thumbnail = NULL WHERE id = ?"
        : "UPDATE tracks SET cover_object = ? WHERE id = ?"
    );
    for (const uploadedObject of uploadedObjects) {
      updateObject.run(uploadedObject.objectName, uploadedObject.id);
    }
    if (stripSqliteCovers) {
      db.prepare("UPDATE tracks SET cover_thumbnail = NULL WHERE cover_object IS NOT NULL").run();
    }
  });
  updateObjects();
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
  console.log(
    `Uploaded ${uploaded} cover(s) and recorded their GCS object names. ` +
      (stripSqliteCovers ? "JPEG BLOBs were removed." : "JPEG BLOBs were preserved.")
  );
}

main().catch((err) => {
  console.error("Cover export failed:", err);
  process.exitCode = 1;
});
