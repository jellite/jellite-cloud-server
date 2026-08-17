import { Storage } from "@google-cloud/storage";

export const DEFAULT_COVERS_PREFIX = "covers";

export function coverObjectName(trackId: string, prefix = DEFAULT_COVERS_PREFIX): string {
  const normalizedPrefix = prefix.replace(/^\/+|\/+$/g, "");
  return normalizedPrefix ? `${normalizedPrefix}/${trackId}.webp` : `${trackId}.webp`;
}

export function createStorage(keyFilename?: string): Storage {
  return keyFilename ? new Storage({ keyFilename }) : new Storage();
}

export async function uploadCover(
  storage: Storage,
  bucketName: string,
  objectName: string,
  webp: Buffer
): Promise<void> {
  await storage.bucket(bucketName).file(objectName).save(webp, {
    resumable: false,
    contentType: "image/webp",
    metadata: {
      cacheControl: "public, max-age=31536000, immutable",
    },
  });
}
