import { resolve } from "node:path";
import { runSync } from "./sync.js";

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
      `Missing required argument --${name}. Usage: --library-root <path> --playlists-dir <path> --db <path> --drive-folder-id <id> [--oauth-token-file <path>] [--username <name>] [--user-id <id>] [--dry-run]`
    );
  }
  return value;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const options = {
    libraryRoot: resolve(requireArg(args, "library-root")),
    playlistsDir: resolve(requireArg(args, "playlists-dir")),
    dbPath: resolve(requireArg(args, "db")),
    driveFolderId: args["dry-run"] ? String(args["drive-folder-id"] ?? "DRY_RUN") : requireArg(args, "drive-folder-id"),
    oauthTokenFilePath: typeof args["oauth-token-file"] === "string" ? resolve(args["oauth-token-file"]) : undefined,
    username: typeof args["username"] === "string" ? args["username"] : "admin",
    userId: typeof args["user-id"] === "string" ? args["user-id"] : "jellite-user",
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
