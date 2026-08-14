#!/usr/bin/env bash
# End-to-end "one command" flow requested in the initial ask: scan every `.m3u` playlist,
# sync only the tracks they reference into the local SQLite DB (uploading only new/changed
# files to Drive), then redeploy the backend with that DB baked into the image.
#
# Usage:
#   infra/sync-and-deploy.sh \
#     --library-root /path/to/music/root \
#     --playlists-dir /path/to/playlists \
#     --drive-folder-id <folder-id> \
#     --oauth-token-file /path/to/.oauth-token.json
#
# Any GCP env vars understood by infra/deploy.sh (GCP_PROJECT, GCP_REGION, ...) also apply.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> Running sync"
npm run sync -- --db "$ROOT_DIR/data/jellite.sqlite" "$@"

echo "==> Deploying"
"$ROOT_DIR/infra/deploy.sh"
