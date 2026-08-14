import { google } from "googleapis";
import type { Response } from "express";
import { config } from "./config.js";

// Falls back to Application Default Credentials when no key file is configured, which is
// the expected setup on Cloud Run (attached runtime service account). Locally, set
// GOOGLE_APPLICATION_CREDENTIALS to a service-account key file with access to the Shared
// Drive that hosts the audio files.
const auth = new google.auth.GoogleAuth({
  keyFile: config.googleApplicationCredentials,
  scopes: ["https://www.googleapis.com/auth/drive.readonly"],
});

const drive = google.drive({ version: "v3", auth });

/**
 * Streams an audio file straight from Google Drive to the HTTP response, passing through
 * the `Range` header 1:1 so clients can seek without the backend having to buffer or
 * understand the audio format. This keeps Drive API usage to "one call per playback" and
 * avoids any transcoding.
 */
export async function streamDriveFile(fileId: string, rangeHeader: string | undefined, res: Response): Promise<void> {
  const driveRes = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    {
      responseType: "stream",
      headers: rangeHeader ? { Range: rangeHeader } : undefined,
    }
  );

  res.status(driveRes.status);
  for (const header of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const value = driveRes.headers[header];
    if (value) res.setHeader(header, value as string);
  }
  if (!res.getHeader("accept-ranges")) {
    res.setHeader("Accept-Ranges", "bytes");
  }

  await new Promise<void>((resolve, reject) => {
    driveRes.data
      .on("end", resolve)
      .on("error", reject)
      .pipe(res);
  });
}
