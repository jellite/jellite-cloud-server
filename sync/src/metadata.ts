import { parseFile } from "music-metadata";
import sharp from "sharp";

export interface ExtractedMetadata {
  title: string | null;
  artist: string | null;
  album: string | null;
  durationMs: number | null;
  coverThumbnail: Buffer | null;
}

const THUMBNAIL_SIZE = 300;

/**
 * Reads tags + embedded cover art from a local FLAC/M4A file and produces a small JPEG
 * thumbnail suitable for storing as a BLOB in SQLite (see SPEC.md section 3/6 — images are
 * pre-extracted so the backend never needs to touch Drive to serve them).
 */
export async function extractMetadata(absolutePath: string): Promise<ExtractedMetadata> {
  const meta = await parseFile(absolutePath, { duration: true, skipCovers: false });
  const { common, format } = meta;

  const picture = common.picture?.[0];
  let coverThumbnail: Buffer | null = null;
  if (picture) {
    try {
      coverThumbnail = await sharp(picture.data)
        .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: "cover" })
        .jpeg({ quality: 80 })
        .toBuffer();
    } catch {
      coverThumbnail = null;
    }
  }

  return {
    title: common.title ?? null,
    artist: common.artist ?? common.albumartist ?? null,
    album: common.album ?? null,
    durationMs: format.duration != null ? Math.round(format.duration * 1000) : null,
    coverThumbnail,
  };
}
