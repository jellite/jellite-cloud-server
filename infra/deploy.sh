#!/usr/bin/env bash
# Builds the backend container (with the current local SQLite DB baked in) and deploys it
# to Google Cloud Run. See docs/SPEC.md section 6 and infra/setup-gcp.md for prerequisites.
#
# Usage: infra/deploy.sh
# Env vars (with defaults): GCP_PROJECT, GCP_REGION, SERVICE_NAME, RUNTIME_SERVICE_ACCOUNT,
# JELLITE_USERNAME, JELLITE_PASSWORD, JELLITE_ACCESS_TOKEN (last two are auto-generated with
# `openssl rand` and printed once if not set — the service is deployed with
# --allow-unauthenticated at the Cloud Run layer, so a real access token matters).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

GCP_PROJECT="${GCP_PROJECT:?Set GCP_PROJECT to your GCP project id}"
GCP_REGION="${GCP_REGION:-europe-central2}"
SERVICE_NAME="${SERVICE_NAME:-jellite}"
# Cloud Run's attached runtime identity — must already have read access to the Drive folder
# (see infra/setup-gcp.md). When unset, Cloud Run uses the project's default compute SA.
RUNTIME_SERVICE_ACCOUNT="${RUNTIME_SERVICE_ACCOUNT:-}"

DB_PATH="$ROOT_DIR/data/jellite.sqlite"
if [ ! -f "$DB_PATH" ]; then
  echo "error: $DB_PATH not found. Run the sync script first (see sync/README.md)." >&2
  exit 1
fi

# The API is exposed with --allow-unauthenticated (Cloud Run has no built-in auth for a
# public music API), so the app-level access token is the only real gate. Never silently
# fall back to the insecure defaults baked into backend/.env.example for a real deploy.
GENERATED_SECRETS=false
JELLITE_USERNAME="${JELLITE_USERNAME:-admin}"
if [ -z "${JELLITE_PASSWORD:-}" ]; then
  JELLITE_PASSWORD="$(openssl rand -hex 12)"
  GENERATED_SECRETS=true
fi
if [ -z "${JELLITE_ACCESS_TOKEN:-}" ]; then
  JELLITE_ACCESS_TOKEN="$(openssl rand -hex 32)"
  GENERATED_SECRETS=true
fi

# gcloud run deploy --source auto-detects a Dockerfile only at the root of the source
# directory (this gcloud version has no --dockerfile flag to point elsewhere), but our
# Dockerfile must be built with the repo root as context (npm workspaces + data/jellite.sqlite).
# Stage a temporary copy at the root and always remove it afterwards, even on failure.
TMP_DOCKERFILE="$ROOT_DIR/Dockerfile"
cleanup() { rm -f "$TMP_DOCKERFILE"; }
trap cleanup EXIT
cp "$ROOT_DIR/backend/Dockerfile" "$TMP_DOCKERFILE"

echo "==> Deploying $SERVICE_NAME to Cloud Run (project=$GCP_PROJECT, region=$GCP_REGION)"

SA_FLAG=()
if [ -n "$RUNTIME_SERVICE_ACCOUNT" ]; then
  SA_FLAG=(--service-account "$RUNTIME_SERVICE_ACCOUNT")
fi

gcloud run deploy "$SERVICE_NAME" \
  --project "$GCP_PROJECT" \
  --region "$GCP_REGION" \
  --source "$ROOT_DIR" \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 3 \
  --set-env-vars "JELLITE_SERVER_NAME=Jellite,JELLITE_USERNAME=${JELLITE_USERNAME},JELLITE_PASSWORD=${JELLITE_PASSWORD},JELLITE_ACCESS_TOKEN=${JELLITE_ACCESS_TOKEN}" \
  "${SA_FLAG[@]}"

echo "==> Deploy complete."
if [ "$GENERATED_SECRETS" = true ]; then
  echo "==> Generated credentials for this deploy (save these now — not stored anywhere else):"
  echo "    JELLITE_USERNAME=$JELLITE_USERNAME"
  echo "    JELLITE_PASSWORD=$JELLITE_PASSWORD"
  echo "    JELLITE_ACCESS_TOKEN=$JELLITE_ACCESS_TOKEN"
  echo "    Re-run with these same JELLITE_* env vars set to keep them stable across deploys."
fi

