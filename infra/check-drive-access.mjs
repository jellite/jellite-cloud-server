#!/usr/bin/env node
// Diagnostic helper: reports what the jellite service account can currently see on Google
// Drive (Shared Drives it's a member of, and any files/folders shared directly with it).
// Run this after following the sharing steps in infra/setup-gcp.md to confirm access
// before running the real sync.
//
// Usage: node infra/check-drive-access.mjs [--key-file ./service-account.json] [--name jellite]
import { google } from "googleapis";
import { resolve } from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const keyFile = resolve(args["key-file"] ?? "./service-account.json");
const searchName = args["name"] ?? "jellite";

const auth = new google.auth.GoogleAuth({
  keyFile,
  scopes: ["https://www.googleapis.com/auth/drive.readonly"],
});
const drive = google.drive({ version: "v3", auth });

async function main() {
  console.log(`Using key file: ${keyFile}\n`);

  const drives = await drive.drives.list({ pageSize: 50 });
  console.log(`Shared Drives the service account is a member of: ${drives.data.drives?.length ?? 0}`);
  for (const d of drives.data.drives ?? []) {
    console.log(`  - "${d.name}" (id: ${d.id})`);
  }

  const visible = await drive.files.list({
    pageSize: 50,
    fields: "files(id, name, mimeType, driveId)",
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    corpora: "allDrives",
  });
  console.log(`\nFiles/folders visible to the service account: ${visible.data.files?.length ?? 0}`);
  for (const f of visible.data.files ?? []) {
    console.log(`  - "${f.name}" (id: ${f.id}, type: ${f.mimeType})`);
  }

  const named = await drive.files.list({
    q: `name = '${searchName}' and mimeType = 'application/vnd.google-apps.folder'`,
    fields: "files(id, name, driveId, parents)",
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    corpora: "allDrives",
  });
  console.log(`\nFolders named "${searchName}": ${named.data.files?.length ?? 0}`);
  for (const f of named.data.files ?? []) {
    console.log(`  - id: ${f.id}${f.driveId ? ` (inside Shared Drive ${f.driveId})` : " (regular folder, not a Shared Drive)"}`);
  }

  if (!visible.data.files?.length && !drives.data.drives?.length) {
    console.log(
      "\nNothing is visible yet. Follow the sharing steps in infra/setup-gcp.md, then re-run this script."
    );
  } else {
    console.log("\nUse one of the folder ids above as --drive-folder-id for the sync script.");
  }
}

main().catch((err) => {
  console.error("Failed to query Google Drive:", err.message);
  if (err.response?.data) console.error(JSON.stringify(err.response.data, null, 2));
  process.exitCode = 1;
});
