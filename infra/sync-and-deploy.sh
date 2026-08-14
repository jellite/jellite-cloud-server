#!/usr/bin/env bash
# End-to-end "one command" flow requested in the initial ask: sync the library described by
# the master list + .m3u playlists into the local SQLite DB (uploading only new files to the
# Shared Drive), then redeploy the backend with that DB baked into the image.
#
# Usage:
#   infra/sync-and-deploy.sh \
#     --library-root /path/to/music/root \
#     --master-list /path/to/file1.sorted \
#     --playlists-dir /path/to/src/domain/playlist \
#     --drive-folder-id <shared-drive-or-folder-id> \
#     --key-file /path/to/jellite-bf32aae81e7e.json
#
# Any GCP env vars understood by infra/deploy.sh (GCP_PROJECT, GCP_REGION, ...) also apply.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> Running sync"
npm run sync -- --db "$ROOT_DIR/data/jellite.sqlite" "$@"

echo "==> Deploying"
"$ROOT_DIR/infra/deploy.sh"
