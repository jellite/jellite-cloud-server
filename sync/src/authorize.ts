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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const clientId = args["client-id"] ?? process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = args["client-secret"] ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const tokenFile = resolve(args["token-file"] ?? "./.oauth-token.json");

  if (!clientId || !clientSecret) {
    console.error(
      "Usage: npm run authorize --workspace sync -- --client-id <id> --client-secret <secret> [--token-file ./.oauth-token.json]\n" +
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
