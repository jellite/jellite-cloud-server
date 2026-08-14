import { readFile } from "node:fs/promises";

/**
 * Parses the master library list (e.g. `file1.sorted`): one relative track path per line,
 * already deduplicated/sorted upstream. Blank lines and `#`-comments are ignored
 * defensively even though the current format doesn't use them.
 */
export async function parseMasterList(path: string): Promise<string[]> {
  const content = await readFile(path, "utf-8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}
