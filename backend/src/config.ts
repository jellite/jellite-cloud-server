import "dotenv/config";

export type ImageHosting = "sqlite" | "gcs";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function commandLineValue(name: string): string | undefined {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

function parseImageHosting(): ImageHosting {
  const value = commandLineValue("image-hosting") ??
    process.env.IMAGE_HOSTING ??
    process.env.JELLITE_IMAGE_HOSTING ??
    "sqlite";
  if (value !== "sqlite" && value !== "gcs") {
    throw new Error(`Invalid image hosting "${value}". Expected "sqlite" or "gcs".`);
  }
  return value;
}

const imageHosting = parseImageHosting();
const gcsBucketName = commandLineValue("gcs-bucket") ?? process.env.GCS_BUCKET_NAME;
if (imageHosting === "gcs" && !gcsBucketName) {
  throw new Error("GCS_BUCKET_NAME is required when IMAGE_HOSTING=gcs");
}

export const config = {
  port: Number(process.env.PORT ?? 8080),

  // Path to the read-only SQLite DB baked into the container image by the sync/deploy flow.
  dbPath: process.env.DB_PATH ?? "./data/jellite.sqlite",

  // Covers stay in SQLite by default. In GCS mode the image route redirects to WebP objects.
  imageHosting,
  gcsBucketName,
  gcsCoversPrefix: commandLineValue("gcs-covers-prefix") ?? process.env.GCS_COVERS_PREFIX ?? "covers",
  gcsPublicBaseUrl: commandLineValue("gcs-public-base-url") ?? process.env.GCS_PUBLIC_BASE_URL,

  // Single, statically configured user (no multi-user support by design, see SPEC.md).
  username: required("JELLITE_USERNAME", "admin"),
  password: required("JELLITE_PASSWORD", "changeme"),
  // Static access token accepted on all authenticated endpoints. Generate a long random
  // value for real deployments, e.g. `openssl rand -hex 32`.
  accessToken: required("JELLITE_ACCESS_TOKEN", "dev-insecure-token"),

  // Stable identifiers returned in Jellyfin-shaped responses.
  serverId: process.env.JELLITE_SERVER_ID ?? "jellite-server",
  serverName: process.env.JELLITE_SERVER_NAME ?? "Jellite",
  // Reported to clients as the Jellyfin server version. The official web client
  // (@jellyfin/sdk discovery logic) rejects/flags servers below its MINIMUM_VERSION or
  // API_VERSION (throws "server version too low" for anything less than the client's
  // built-in API_VERSION) — keep this at or above the current stable Jellyfin release.
  serverVersion: process.env.JELLITE_SERVER_VERSION ?? "10.11.11",
  userId: process.env.JELLITE_USER_ID ?? "jellite-user",

  // Optional path to a service-account key file for Google Drive access. When unset, the
  // Google Auth Library falls back to Application Default Credentials (e.g. the Cloud Run
  // runtime service account), which is the recommended setup in production.
  googleApplicationCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS,

  // Comma-separated list of allowed origins for CORS (web clients, e.g. Jellyfin Web /
  // Finamp web builds running in a browser). Use "*" (the default) to allow any origin —
  // fine for a single-user server with a static token, but set an explicit allow-list in
  // production if you want to restrict which sites can call this API from a browser.
  corsAllowedOrigins: (process.env.JELLITE_CORS_ORIGINS ?? "*")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0),
};
