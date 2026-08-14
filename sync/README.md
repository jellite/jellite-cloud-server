# @jellite/sync

Local-only script that syncs the music library into `data/jellite.sqlite`, uploading only
new/changed files to Google Drive (see [`docs/SPEC.md`](../docs/SPEC.md) section 5).

> **Note on auth**: uploads run via OAuth2 as your own Google account (see "One-time OAuth
> authorization" below), not the service account. Service accounts always have 0 GB of
> their own Drive storage quota, so uploads into a regular "My Drive" folder fail with
> `storageQuotaExceeded` — confirmed empirically while setting this project up (see
> `../infra/setup-gcp.md` section 3). The service account is still used by the backend for
> read-only streaming, which works fine since the folder is shared with it.

## One-time OAuth authorization (required before the first real sync)

```bash
npm run authorize --workspace sync -- \
  --client-id <OAUTH_CLIENT_ID> \
  --client-secret <OAUTH_CLIENT_SECRET> \
  --token-file ./.oauth-token.json
```

Opens a URL to sign in with the Google account that owns the Drive folder; saves a refresh
token to `--token-file` (gitignored) for reuse by every subsequent sync. See
`../infra/setup-gcp.md` section 3a for how to create the OAuth client.

## Usage

```bash
npm install   # from repo root

npm run sync -- \
  --library-root /path/to/music/root \
  --master-list /path/to/file1.sorted \
  --playlists-dir /path/to/src/domain/playlist \
  --db /path/to/jellite/data/jellite.sqlite \
  --drive-folder-id <drive-folder-id> \
  --oauth-token-file ./.oauth-token.json
```

Add `--dry-run` to skip Google Drive uploads entirely (useful for testing the
metadata/playlist logic without real credentials — a placeholder id is stored instead of a
real Drive file id, and `--oauth-token-file` isn't required).

## What it does

1. Reads the master list (`--master-list`) — the full, deduplicated list of relative track
   paths — and diffs it against tracks already present in the DB (matched by path + file
   size) to find new or changed files.
2. For each new/changed file: extracts tags (title/artist/album/duration) and a resized
   (300x300 JPEG) cover thumbnail from embedded FLAC/M4A tags, uploads the raw audio file to
   the configured Drive folder, and upserts a `tracks` row.
3. Reads every `.m3u` file in `--playlists-dir` and rebuilds the `playlists` /
   `playlist_tracks` tables (playlist name = file name, order = file order).
4. Logs (without deleting) any tracks present in the DB but no longer in the master list.

## Typical end-to-end flow

Use `infra/sync-and-deploy.sh` instead of calling this directly, to also redeploy the
backend with the updated DB afterwards.
