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

**Status: already done and verified for this project** (see `../infra/setup-gcp.md`
section 3a) — the resulting token lives at `/path/to/jellite/.oauth-token.json`
(gitignored). The steps below are for reference / re-authorizing on a new machine or after
revoking access.

```bash
npm run authorize --workspace sync -- \
  --client-secret-file /path/to/client_secret_...apps.googleusercontent.com.json \
  --token-file /path/to/jellite/.oauth-token.json
```

(`--client-id`/`--client-secret` are also accepted directly instead of
`--client-secret-file`, if you'd rather not point at the downloaded JSON.)

Opens a URL to sign in with the Google account that owns the Drive folder; saves a refresh
token to `--token-file` (gitignored) for reuse by every subsequent sync. See
`../infra/setup-gcp.md` section 3a for how to create the OAuth client. Note: `npm run ...
--workspace sync` sets the working directory to `sync/`, so relative paths passed to
`--token-file`/`--client-secret-file` resolve from there — prefer absolute paths.

## Usage

```bash
npm install   # from repo root

npm run sync -- \
  --library-root /path/to/music/root \
  --playlists-dir /path/to/playlists \
  --db /path/to/jellite/data/jellite.sqlite \
  --drive-folder-id <drive-folder-id> \
  --oauth-token-file ./.oauth-token.json
```

Add `--dry-run` to skip Google Drive uploads entirely (useful for testing the
metadata/playlist logic without real credentials — a placeholder id is stored instead of a
real Drive file id, and `--oauth-token-file` isn't required).

## What it does

1. Reads every `.m3u` file in `--playlists-dir` and collects the union of every track path
   they reference (paths in `.m3u` files are relative to the playlists directory itself,
   e.g. `../Artist/Foo/Bar.flac` — these get resolved and re-expressed relative to
   `--library-root` for storage). Only files that are actually on a playlist are ever
   touched — the library root is never scanned wholesale.
2. Diffs that set against tracks already present in the DB (matched by path + file size) to
   find new or changed files.
3. For each new/changed file: extracts tags (title/artist/album/duration) and a resized
   (300x300 JPEG) cover thumbnail from embedded FLAC/M4A tags, uploads the raw audio file to
   the configured Drive folder, and upserts a `tracks` row.
4. Rebuilds the `playlists` / `playlist_tracks` tables from the parsed `.m3u` files
   (playlist name = file name, order = file order).
5. Logs (without deleting) any tracks present in the DB but no longer referenced by any
   playlist.

## Progress output

The sync prints a running `[i/total] NN% ...` progress indicator while it processes
tracks — uploads and warnings (missing files) always print immediately, while routine
"up to date" ticks are throttled (in a TTY the line is redrawn in place; when output is
piped to a log file, e.g. a cron job on Unraid, only every 25th tick plus the final one is
printed, to avoid flooding the log for large libraries). A final summary line reports the
total counts and elapsed time.

## Typical end-to-end flow

Use `infra/sync-and-deploy.sh` instead of calling this directly, to also redeploy the
backend with the updated DB afterwards.
