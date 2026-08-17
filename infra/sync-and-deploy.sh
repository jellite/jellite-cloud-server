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

# Keep sync and backend on the same image source when the one-command flow is used with
# command-line options. Environment variables remain supported for CI/Cloud Run deployments.
IMAGE_HOSTING="${IMAGE_HOSTING:-sqlite}"
GCS_BUCKET_NAME="${GCS_BUCKET_NAME:-}"
GCS_COVERS_PREFIX="${GCS_COVERS_PREFIX:-covers}"
GCS_PUBLIC_BASE_URL="${GCS_PUBLIC_BASE_URL:-}"
SYNC_ARGS=("$@")
while [ "$#" -gt 0 ]; do
  case "$1" in
    --image-hosting) IMAGE_HOSTING="${2:?Missing value for --image-hosting}"; shift ;;
    --gcs-bucket) GCS_BUCKET_NAME="${2:?Missing value for --gcs-bucket}"; shift ;;
    --gcs-covers-prefix) GCS_COVERS_PREFIX="${2:?Missing value for --gcs-covers-prefix}"; shift ;;
    --gcs-public-base-url) GCS_PUBLIC_BASE_URL="${2:?Missing value for --gcs-public-base-url}"; shift ;;
  esac
  shift
done
export IMAGE_HOSTING GCS_BUCKET_NAME GCS_COVERS_PREFIX GCS_PUBLIC_BASE_URL

echo "==> Running sync"
npm run sync -- --db "$ROOT_DIR/data/jellite.sqlite" "${SYNC_ARGS[@]}"

echo "==> Deploying"
"$ROOT_DIR/infra/deploy.sh"
