import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runOAuthAuthorization } from "./oauth.js";

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

/**
 * Reads client id/secret directly from the JSON file downloaded from GCP Console when
 * creating a "Desktop app" OAuth 2.0 Client ID (shape: `{ installed: { client_id,
 * client_secret, ... } }`, sometimes `web` instead of `installed`).
 */
async function loadClientSecretFile(path: string): Promise<{ clientId: string; clientSecret: string }> {
  const raw = JSON.parse(await readFile(path, "utf-8"));
  const section = raw.installed ?? raw.web;
  if (!section?.client_id || !section?.client_secret) {
    throw new Error(`Could not find client_id/client_secret in ${path}`);
  }
  return { clientId: section.client_id, clientSecret: section.client_secret };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tokenFile = resolve(args["token-file"] ?? "./.oauth-token.json");

  let clientId = args["client-id"] ?? process.env.GOOGLE_OAUTH_CLIENT_ID;
  let clientSecret = args["client-secret"] ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET;

  if (args["client-secret-file"]) {
    ({ clientId, clientSecret } = await loadClientSecretFile(resolve(args["client-secret-file"])));
  }

  if (!clientId || !clientSecret) {
    console.error(
      "Usage: npm run authorize --workspace sync -- --client-secret-file <downloaded_client_secret.json> [--token-file ./.oauth-token.json]\n" +
        "  or: npm run authorize --workspace sync -- --client-id <id> --client-secret <secret>\n" +
        "(or set GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET)\n\n" +
        "Create a Desktop app OAuth 2.0 Client ID first in GCP Console > APIs & Services > Credentials (see infra/setup-gcp.md)."
    );
    process.exitCode = 1;
    return;
  }

  await runOAuthAuthorization({ clientId, clientSecret }, tokenFile);
}

main().catch((err) => {
  console.error("Authorization failed:", err);
  process.exitCode = 1;
});

