import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { OAuth2Client } from "google-auth-library";

// Full Drive scope (not the narrower `drive.file`) because we need to upload into an
// existing folder (the shared "jellite" folder) that this OAuth app didn't create itself;
// `drive.file` only grants access to files/folders the app created or the user picked via
// the Drive Picker UI, which doesn't apply here.
const SCOPES = ["https://www.googleapis.com/auth/drive"];
const REDIRECT_PORT = 8765;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * Service accounts have no Google Drive storage quota of their own (confirmed while
 * setting this project up: uploading into a regular "My Drive" folder shared with the SA
 * fails with `storageQuotaExceeded`, since that requires either a Shared Drive — which
 * needs Google Workspace — or OAuth delegation). For a plain personal Gmail account, the
 * pragmatic fix is to have the *sync script* upload as the user themselves via a one-time
 * OAuth2 "installed app" (loopback) flow, storing a refresh token locally for reuse. The
 * backend keeps using the service account for read-only streaming, since the SA already
 * has read access to the shared folder.
 */
export async function runOAuthAuthorization(creds: OAuthCredentials, tokenFilePath: string): Promise<void> {
  const client = new OAuth2Client(creds.clientId, creds.clientSecret, REDIRECT_URI);

  const authUrl = client.generateAuthUrl({ access_type: "offline", scope: SCOPES, prompt: "consent" });

  console.log("\nOpen this URL in a browser and grant access with the Google account that owns the jellite folder:\n");
  console.log(authUrl);
  console.log(`\nWaiting for the OAuth redirect on ${REDIRECT_URI} ...`);

  const code = await new Promise<string>((resolvePromise, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", REDIRECT_URI);
      const authCode = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      res.end(authCode ? "Authorization complete — you can close this tab and return to the terminal." : "Authorization failed.");
      server.close();

      if (error) reject(new Error(`OAuth authorization failed: ${error}`));
      else if (authCode) resolvePromise(authCode);
      else reject(new Error("No authorization code received"));
    });
    server.listen(REDIRECT_PORT);
  });

  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "No refresh token returned. If you've authorized this app before, revoke access at https://myaccount.google.com/permissions and try again (Google only issues a refresh token on first consent, or when prompt=consent forces re-consent)."
    );
  }

  await writeFile(tokenFilePath, JSON.stringify({ ...creds, ...tokens }, null, 2), { mode: 0o600 });
  console.log(`\nSaved OAuth token to ${tokenFilePath}. Keep this file secret (it's gitignored).`);
}

export async function loadOAuthClient(tokenFilePath: string): Promise<OAuth2Client> {
  if (!existsSync(tokenFilePath)) {
    throw new Error(
      `OAuth token file not found at ${tokenFilePath}. Run the one-time authorization first (see sync/README.md).`
    );
  }
  const saved = JSON.parse(await readFile(tokenFilePath, "utf-8"));
  const client = new OAuth2Client(saved.clientId, saved.clientSecret, REDIRECT_URI);
  client.setCredentials(saved);
  return client;
}
