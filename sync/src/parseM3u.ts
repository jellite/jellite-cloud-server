import { readdir, readFile } from "node:fs/promises";
import { join, basename, extname } from "node:path";

export interface ParsedPlaylist {
  /** Playlist name, derived from the `.m3u` file name without extension. */
  name: string;
  /** Ordered, relative track paths as listed in the `.m3u` file. */
  trackPaths: string[];
}

/**
 * Parses every `.m3u` file in a directory into a playlist name + ordered track path list.
 * Extended M3U directives (`#EXTM3U`, `#EXTINF:...`) are ignored — only the plain path
 * lines are used, matching the simple format produced by the upstream project.
 */
export async function parsePlaylistsDir(dir: string): Promise<ParsedPlaylist[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const m3uFiles = entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".m3u"));

  const playlists: ParsedPlaylist[] = [];
  for (const entry of m3uFiles) {
    const content = await readFile(join(dir, entry.name), "utf-8");
    const trackPaths = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    playlists.push({ name: basename(entry.name, extname(entry.name)), trackPaths });
  }
  return playlists;
}
