import { createReadStream } from "node:fs";
import { extname } from "node:path";
import { google, drive_v3 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { loadOAuthClient } from "./oauth.js";

const MIME_TYPES: Record<string, string> = {
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
};

/**
 * Service-account client — kept around because the SA still has read access to the shared
 * "jellite" folder (useful for diagnostics), but cannot upload (0 GB own quota, confirmed
 * empirically: uploads fail with `storageQuotaExceeded` on a regular Drive folder).
 */
export function createServiceAccountDriveClient(keyFilePath?: string): drive_v3.Drive {
  const auth = new google.auth.GoogleAuth({
    keyFile: keyFilePath,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth });
}

/**
 * OAuth2 client authenticated as the actual Google account that owns the "jellite" folder
 * (see sync/src/oauth.ts). Used for uploads on plain (non-Workspace) Google accounts, since
 * those uploads then count against the *user's* storage quota rather than the service
 * account's (which is always zero).
 */
export async function createOAuthDriveClient(tokenFilePath: string): Promise<drive_v3.Drive> {
  const auth: OAuth2Client = await loadOAuthClient(tokenFilePath);
  return google.drive({ version: "v3", auth });
}

/**
 * Uploads a single local audio file into the Drive folder that hosts the library. Only
 * ever called for files not already present in the local SQLite DB (see sync.ts), keeping
 * Drive API usage to "one upload call per genuinely new file".
 */
export async function uploadAudioFile(
  drive: drive_v3.Drive,
  localPath: string,
  fileName: string,
  driveFolderId: string
): Promise<string> {
  const mimeType = MIME_TYPES[extname(localPath).toLowerCase()] ?? "application/octet-stream";

  const res = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: fileName,
      parents: [driveFolderId],
    },
    media: {
      mimeType,
      body: createReadStream(localPath),
    },
    fields: "id",
  });

  if (!res.data.id) {
    throw new Error(`Google Drive did not return a file id for upload of "${localPath}"`);
  }
  return res.data.id;
}

