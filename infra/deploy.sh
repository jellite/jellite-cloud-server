#!/usr/bin/env bash
# Builds the backend container (with the current local SQLite DB baked in) and deploys it
# to Google Cloud Run. See docs/SPEC.md section 6 and infra/setup-gcp.md for prerequisites.
#
# Usage: infra/deploy.sh
# Env vars (with defaults): GCP_PROJECT, GCP_REGION, SERVICE_NAME, RUNTIME_SERVICE_ACCOUNT
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

GCP_PROJECT="${GCP_PROJECT:?Set GCP_PROJECT to your GCP project id}"
GCP_REGION="${GCP_REGION:-europe-central2}"
SERVICE_NAME="${SERVICE_NAME:-jellite}"
# Cloud Run's attached runtime identity — must already be a member of the Shared Drive
# (see infra/setup-gcp.md). When unset, Cloud Run uses the project's default compute SA.
RUNTIME_SERVICE_ACCOUNT="${RUNTIME_SERVICE_ACCOUNT:-}"

DB_PATH="$ROOT_DIR/data/jellite.sqlite"
if [ ! -f "$DB_PATH" ]; then
  echo "error: $DB_PATH not found. Run the sync script first (see sync/README.md)." >&2
  exit 1
fi

echo "==> Deploying $SERVICE_NAME to Cloud Run (project=$GCP_PROJECT, region=$GCP_REGION)"

SA_FLAG=()
if [ -n "$RUNTIME_SERVICE_ACCOUNT" ]; then
  SA_FLAG=(--service-account "$RUNTIME_SERVICE_ACCOUNT")
fi

gcloud run deploy "$SERVICE_NAME" \
  --project "$GCP_PROJECT" \
  --region "$GCP_REGION" \
  --source "$ROOT_DIR" \
  --dockerfile backend/Dockerfile \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 3 \
  --set-env-vars "JELLITE_SERVER_NAME=Jellite" \
  "${SA_FLAG[@]}"

echo "==> Deploy complete."
