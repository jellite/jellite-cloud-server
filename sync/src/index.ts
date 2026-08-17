import { resolve } from "node:path";
import { runSync } from "./sync.js";
import { DEFAULT_COVERS_PREFIX } from "./gcs.js";
import { parseImageHosting } from "./imageHosting.js";

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

function requireArg(args: Record<string, string | boolean>, name: string): string {
  const value = args[name];
  if (typeof value !== "string") {
    throw new Error(
      `Missing required argument --${name}. Usage: --library-root <path> --playlists-dir <path> --db <path> --drive-folder-id <id> [--image-hosting sqlite|gcs] [--gcs-bucket <name>] [--oauth-token-file <path>] [--username <name>] [--user-id <id>] [--dry-run]`
    );
  }
  return value;
}

function optionalString(args: Record<string, string | boolean>, name: string): string | undefined {
  return typeof args[name] === "string" ? args[name] : undefined;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const imageHosting = parseImageHosting(optionalString(args, "image-hosting") ?? process.env.IMAGE_HOSTING);
  const gcsBucketName = optionalString(args, "gcs-bucket") ?? process.env.GCS_BUCKET_NAME;
  const gcsKeyFile = optionalString(args, "gcs-key-file") ?? process.env.GCS_KEY_FILE;
  if (imageHosting === "gcs" && !gcsBucketName && !args["dry-run"]) {
    throw new Error("Missing --gcs-bucket (or GCS_BUCKET_NAME) when --image-hosting gcs is used");
  }

  const options = {
    libraryRoot: resolve(requireArg(args, "library-root")),
    playlistsDir: resolve(requireArg(args, "playlists-dir")),
    dbPath: resolve(requireArg(args, "db")),
    driveFolderId: args["dry-run"] ? String(args["drive-folder-id"] ?? "DRY_RUN") : requireArg(args, "drive-folder-id"),
    oauthTokenFilePath: typeof args["oauth-token-file"] === "string" ? resolve(args["oauth-token-file"]) : undefined,
    username: typeof args["username"] === "string" ? args["username"] : "admin",
    userId: typeof args["user-id"] === "string" ? args["user-id"] : "jellite-user",
    imageHosting,
    gcsBucketName,
    gcsCoversPrefix: optionalString(args, "gcs-covers-prefix") ?? process.env.GCS_COVERS_PREFIX ?? DEFAULT_COVERS_PREFIX,
    googleApplicationCredentials: gcsKeyFile ?? process.env.GOOGLE_APPLICATION_CREDENTIALS,
    dryRun: Boolean(args["dry-run"]),
  };

  console.log("Starting jellite sync with options:", {
    ...options,
    oauthTokenFilePath: options.oauthTokenFilePath ? "(set)" : undefined,
  });
  const result = await runSync(options);
  console.log("Sync complete:", result);
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exitCode = 1;
});
