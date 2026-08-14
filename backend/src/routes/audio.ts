import { Router } from "express";
import { requireAuth } from "../auth.js";
import { getTrack } from "../db.js";
import { streamDriveFile } from "../driveClient.js";

export const audioRouter = Router();
audioRouter.use(requireAuth);

/**
 * Streams the raw audio bytes straight from Google Drive. Seeking to a specific playback
 * position is handled entirely via the standard HTTP `Range` header, forwarded 1:1 to
 * Drive and back — no transcoding, no separate "seek" endpoint (see SPEC.md).
 */
async function handleStream(req: import("express").Request, res: import("express").Response) {
  const track = getTrack(req.params.id);
  if (!track) {
    res.status(404).json({ error: "Track not found" });
    return;
  }

  try {
    await streamDriveFile(track.drive_file_id, req.header("Range"), res);
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).json({ error: "Failed to stream from Google Drive" });
    }
    // eslint-disable-next-line no-console
    console.error(`Failed to stream track ${track.id} from Drive:`, err);
  }
}

audioRouter.get("/Audio/:id/stream", handleStream);
audioRouter.get("/Audio/:id/stream.:ext", handleStream);
audioRouter.get("/Audio/:id/universal", handleStream);

/**
 * Finamp's actual direct-play URL (confirmed via its source, _songUri() in
 * music_player_background_task.dart): for non-transcoded playback it builds
 * "{baseUrl}/Items/{id}/File?ApiKey=...", NOT /Audio/{id}/stream. The same URL is
 * also used by downloads_helper.dart for offline downloads. We didn't have this
 * route at all, causing a 404 and silent playback failure.
 */
audioRouter.get("/Items/:id/File", handleStream);
