import { createReadStream } from "node:fs";
import { extname } from "node:path";
import { google, drive_v3 } from "googleapis";

const MIME_TYPES: Record<string, string> = {
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
};

export function createDriveClient(keyFilePath?: string): drive_v3.Drive {
  const auth = new google.auth.GoogleAuth({
    keyFile: keyFilePath,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth });
}

/**
 * Uploads a single local audio file into the Shared Drive folder that hosts the library.
 * Only ever called for files not already present in the local SQLite DB (see sync.ts),
 * keeping Drive API usage to "one upload call per genuinely new file".
 */
export async function uploadAudioFile(
  drive: drive_v3.Drive,
  localPath: string,
  fileName: string,
  sharedDriveFolderId: string
): Promise<string> {
  const mimeType = MIME_TYPES[extname(localPath).toLowerCase()] ?? "application/octet-stream";

  const res = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: fileName,
      parents: [sharedDriveFolderId],
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
