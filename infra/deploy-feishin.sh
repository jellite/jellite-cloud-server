#!/usr/bin/env bash
# Deploys the Feishin web client as a separate Cloud Run service.
#
# The domain/path routing is intentionally configured outside this script: route /web and
# /web/* to this service, and route the Jellyfin-compatible API paths to the Jellite service.
#
# Usage:
#   GCP_PROJECT=<your-gcp-project> bash infra/deploy-feishin.sh
#
# Env vars:
#   GCP_PROJECT              required GCP project id
#   GCP_REGION               default: europe-west1
#   FEISHIN_SERVICE_NAME     default: jellite-web
#   FEISHIN_IMAGE            default: ghcr.io/jeffvli/feishin:latest
#   FEISHIN_PUBLIC_PATH      default: /web
#   JELLITE_PUBLIC_URL       default: https://jellite.example.com
#   FEISHIN_SERVER_NAME      default: Jellite
#   FEISHIN_SERVER_LOCK      default: true
set -euo pipefail

GCP_PROJECT="${GCP_PROJECT:?Set GCP_PROJECT to your GCP project id}"
GCP_REGION="${GCP_REGION:-europe-west1}"
FEISHIN_SERVICE_NAME="${FEISHIN_SERVICE_NAME:-jellite-web}"
FEISHIN_IMAGE="${FEISHIN_IMAGE:-ghcr.io/jeffvli/feishin:latest}"
FEISHIN_PUBLIC_PATH="${FEISHIN_PUBLIC_PATH:-/web}"
JELLITE_PUBLIC_URL="${JELLITE_PUBLIC_URL:-https://jellite.example.com}"
FEISHIN_SERVER_NAME="${FEISHIN_SERVER_NAME:-Jellite}"
FEISHIN_SERVER_LOCK="${FEISHIN_SERVER_LOCK:-true}"

ENV_VARS="PUBLIC_PATH=${FEISHIN_PUBLIC_PATH},SERVER_NAME=${FEISHIN_SERVER_NAME},SERVER_TYPE=jellyfin,SERVER_URL=${JELLITE_PUBLIC_URL},SERVER_LOCK=${FEISHIN_SERVER_LOCK},ANALYTICS_DISABLED=true"

echo "==> Deploying $FEISHIN_SERVICE_NAME to Cloud Run (project=$GCP_PROJECT, region=$GCP_REGION)"
echo "==> Feishin image: $FEISHIN_IMAGE"
echo "==> Feishin public path: $FEISHIN_PUBLIC_PATH"
echo "==> Jellite server URL: $JELLITE_PUBLIC_URL"

gcloud run deploy "$FEISHIN_SERVICE_NAME" \
  --project "$GCP_PROJECT" \
  --region "$GCP_REGION" \
  --image "$FEISHIN_IMAGE" \
  --allow-unauthenticated \
  --port 9180 \
  --memory 512Mi \
  --min-instances 0 \
  --max-instances 2 \
  --set-env-vars "$ENV_VARS"

echo "==> Deploy complete."
echo "==> Configure domain routing so /web and /web/* point to this service."
