# @jellite/sync

Local-only script that syncs the music library into `data/jellite.sqlite`, uploading only
new/changed files to a Google Shared Drive (see [`docs/SPEC.md`](../docs/SPEC.md) section 5).

## Usage

```bash
npm install   # from repo root

npm run sync -- \
  --library-root /path/to/music/root \
  --master-list /path/to/file1.sorted \
  --playlists-dir /path/to/src/domain/playlist \
  --db /path/to/jellite/data/jellite.sqlite \
  --drive-folder-id <shared-drive-or-folder-id> \
  --key-file /path/to/jellite-bf32aae81e7e.json
```

Add `--dry-run` to skip Google Drive uploads entirely (useful for testing the
metadata/playlist logic without real credentials — a placeholder id is stored instead of a
real Drive file id).

## What it does

1. Reads the master list (`--master-list`) — the full, deduplicated list of relative track
   paths — and diffs it against tracks already present in the DB (matched by path + file
   size) to find new or changed files.
2. For each new/changed file: extracts tags (title/artist/album/duration) and a resized
   (300x300 JPEG) cover thumbnail from embedded FLAC/M4A tags, uploads the raw audio file to
   the configured Shared Drive folder, and upserts a `tracks` row.
3. Reads every `.m3u` file in `--playlists-dir` and rebuilds the `playlists` /
   `playlist_tracks` tables (playlist name = file name, order = file order).
4. Logs (without deleting) any tracks present in the DB but no longer in the master list.

## Typical end-to-end flow

Use `infra/sync-and-deploy.sh` instead of calling this directly, to also redeploy the
backend with the updated DB afterwards.
