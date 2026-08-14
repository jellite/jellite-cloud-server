import { createHash } from "node:crypto";

/**
 * Deterministic id for a track, derived from its relative path. Must stay stable across
 * re-syncs (see SPEC.md open question) so client-side state (e.g. playback history) tied
 * to an item id doesn't break when the library is resynced.
 */
export function trackId(relativePath: string): string {
  return createHash("sha1").update(relativePath).digest("hex");
}

/**
 * Deterministic id for a playlist, derived from its `.m3u` file name (without extension).
 */
export function playlistId(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || createHash("sha1").update(name).digest("hex");
}
