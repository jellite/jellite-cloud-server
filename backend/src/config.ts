import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),

  // Path to the read-only SQLite DB baked into the container image by the sync/deploy flow.
  dbPath: process.env.DB_PATH ?? "./data/jellite.sqlite",

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
