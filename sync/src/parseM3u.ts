import { readdir, readFile } from "node:fs/promises";
import { join, basename, extname, resolve, relative } from "node:path";

export interface ParsedPlaylist {
  /** Playlist name, derived from the `.m3u` file name without extension. */
  name: string;
  /**
   * Ordered track paths as listed in the `.m3u` file, normalized to be relative to
   * `libraryRoot` (this is what's stored/keyed in the DB, regardless of how the `.m3u`
   * expressed the path — e.g. `../Artist/Foo/Bar.flac` relative to the playlists dir).
   */
  trackPaths: string[];
}

/**
 * Parses every `.m3u` file in a directory into a playlist name + ordered track path list.
 * Extended M3U directives (`#EXTM3U`, `#EXTINF:...`) are ignored — only the plain path
 * lines are used, matching the simple format produced by the upstream project.
 *
 * Paths inside `.m3u` files are relative to the playlists directory itself (e.g.
 * `../Artist/Foo/Bar.flac`), not to `libraryRoot` directly. Each entry is resolved to an
 * absolute path and then re-expressed relative to `libraryRoot` for consistent storage.
 */
export async function parsePlaylistsDir(dir: string, libraryRoot: string): Promise<ParsedPlaylist[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const m3uFiles = entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".m3u"));

  const playlists: ParsedPlaylist[] = [];
  for (const entry of m3uFiles) {
    const content = await readFile(join(dir, entry.name), "utf-8");
    const trackPaths = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .map((line) => relative(libraryRoot, resolve(dir, line)));

    playlists.push({ name: basename(entry.name, extname(entry.name)), trackPaths });
  }
  return playlists;
}
