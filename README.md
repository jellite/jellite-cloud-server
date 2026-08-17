# jellite

A lightweight, API-only music server implementing a subset of the Jellyfin API,
deployed on Google Cloud Run. Audio files (FLAC/M4A) are stored on Google Drive (a
regular folder in "My Drive", not a Shared Drive — see `infra/setup-gcp.md` section 3),
metadata and playlists live in a locally-built SQLite database baked into the container
image. Cover art can stay in SQLite or be hosted as WebP objects in Google Cloud Storage.

Full project specification: [`docs/SPEC.md`](docs/SPEC.md).

## Status

Specification and implementation (backend + sync + infra) complete. The
Google Drive/OAuth setup has been **verified end-to-end** with a real upload from a
music library (see `infra/setup-gcp.md`) — the sync script is ready to use, and the
backend has been deployed and tested against a real Jellyfin-compatible client (Finamp).

## Repository layout

```
docs/     — project specification (docs/SPEC.md)
backend/  — Jellyfin-compatible API server (Express + TypeScript)
sync/     — library sync script (.m3u playlists) -> Google Drive + SQLite
infra/    — deployment scripts (Cloud Run) + one-time GCP setup
data/     — where the local jellite.sqlite database lives (see data/README.md);
            not committed in this repo — generate your own with `npm run sync`
```

## Quick start

```bash
npm install                         # installs backend + sync (npm workspaces)
npm run build                       # compiles both TypeScript packages
npm run backend                     # runs the backend alone (no sync), on port 8080
```

Before you can run the backend for real, you need:

1. A GCP project with Cloud Run, Cloud Build and Drive API enabled, plus a service
   account for read-only Drive access from the backend — see `infra/setup-gcp.md`.
2. A Google Drive folder containing your music, shared with that service account.
3. A one-time OAuth authorization (your own Google account, not the service account)
   used by the sync script to upload files — see `sync/README.md`.
4. Your own local music library, organized with `.m3u` playlists (see
   `docs/SPEC.md` section 5 for how the sync script derives the track list from them).

Once set up, generate your database and deploy in one step:

```bash
infra/sync-and-deploy.sh \
  --library-root /path/to/your/music/library \
  --playlists-dir /path/to/your/playlists \
  --drive-folder-id <your-drive-folder-id> \
  --oauth-token-file ./.oauth-token.json
```

Or just build the database locally without deploying:

```bash
npm run sync -- \
  --library-root /path/to/your/music/library \
  --playlists-dir /path/to/your/playlists \
  --db data/jellite.sqlite \
  --drive-folder-id <your-drive-folder-id> \
  --oauth-token-file ./.oauth-token.json
```

### GCS cover hosting

The default image mode is `sqlite`. To use GCS, first create a bucket with public object reads
and grant the identity used by the exporter `roles/storage.objectUser` on that bucket. Jellyfin
clients request image URLs without an API token, so public read access (or a public CDN URL) is
required for the redirect target.

Export a small sample from an existing SQLite database:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/gcs-uploader-credentials.json
npm run export-covers --workspace sync -- \
  --db data/jellite.sqlite \
  --gcs-bucket <covers-bucket> \
  --limit 3
```

Run the full export. It is resumable and skips rows that already have `cover_object`:

```bash
npm run export-covers --workspace sync -- \
  --db data/jellite.sqlite \
  --gcs-bucket <covers-bucket>
```

Use `--overwrite` to upload every SQLite cover again, or use `--strip-sqlite-covers` after
verifying GCS to remove the old JPEG BLOBs and reduce the database size:

```bash
npm run export-covers --workspace sync -- \
  --db data/jellite.sqlite \
  --gcs-bucket <covers-bucket> \
  --overwrite

npm run export-covers --workspace sync -- \
  --db data/jellite.sqlite \
  --gcs-bucket <covers-bucket> \
  --strip-sqlite-covers
```

Deploy the backend in GCS mode:

```bash
export IMAGE_HOSTING=gcs
export GCS_BUCKET_NAME=<covers-bucket>
export GCS_COVERS_PREFIX=covers

bash infra/deploy.sh
```

Or sync new tracks and deploy in one step. The same image-hosting flags are forwarded to both
the sync process and Cloud Run:

```bash
infra/sync-and-deploy.sh \
  --library-root /path/to/your/music/library \
  --playlists-dir /path/to/your/playlists \
  --drive-folder-id <your-drive-folder-id> \
  --oauth-token-file /path/to/.oauth-token.json \
  --image-hosting gcs \
  --gcs-bucket <covers-bucket> \
  --gcs-covers-prefix covers
```

### Deploying / rotating credentials

```bash
export GCP_PROJECT=<your-gcp-project> && export RUNTIME_SERVICE_ACCOUNT=<your-service-account-email> && export JELLITE_USERNAME=admin && export JELLITE_PASSWORD="$(openssl rand -hex 12)" && export JELLITE_ACCESS_TOKEN="$(openssl rand -hex 32)" && bash infra/deploy.sh 2>&1
```

`infra/deploy.sh` prints the generated `JELLITE_PASSWORD`/`JELLITE_ACCESS_TOKEN` once at the
end — save them in a password manager, never commit real values into this file.
