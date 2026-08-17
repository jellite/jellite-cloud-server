import { parseFile } from "music-metadata";
import sharp from "sharp";
import type { ImageHosting } from "./imageHosting.js";

export interface ExtractedMetadata {
  title: string | null;
  artist: string | null;
  album: string | null;
  durationMs: number | null;
  coverThumbnail: Buffer | null;
  coverWebp: Buffer | null;
}

const THUMBNAIL_SIZE = 300;

/**
 * Reads tags + embedded cover art from a local FLAC/M4A file and produces the format selected
 * by the image hosting mode.
 */
export async function extractMetadata(
  absolutePath: string,
  imageHosting: ImageHosting = "sqlite"
): Promise<ExtractedMetadata> {
  const meta = await parseFile(absolutePath, { duration: true, skipCovers: false });
  const { common, format } = meta;

  const picture = common.picture?.[0];
  let coverThumbnail: Buffer | null = null;
  let coverWebp: Buffer | null = null;
  if (picture) {
    try {
      const image = sharp(picture.data).resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: "cover" });
      if (imageHosting === "sqlite") {
        coverThumbnail = await image.jpeg({ quality: 80 }).toBuffer();
      } else {
        coverWebp = await image.webp({ quality: 80 }).toBuffer();
      }
    } catch {
      coverThumbnail = null;
      coverWebp = null;
    }
  }

  return {
    title: common.title ?? null,
    artist: common.artist ?? common.albumartist ?? null,
    album: common.album ?? null,
    durationMs: format.duration != null ? Math.round(format.duration * 1000) : null,
    coverThumbnail,
    coverWebp,
  };
}
