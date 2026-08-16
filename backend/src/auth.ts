import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";

/**
 * Jellyfin clients send the access token either as `X-Emby-Token` / `X-MediaBrowser-Token`
 * header, or embedded in an `Authorization: MediaBrowser ..., Token="..."` header. We accept
 * all three forms since real-world clients (e.g. Finamp) vary in which they use.
 */
function extractToken(req: Request): string | undefined {
  const direct = req.header("X-Emby-Token") ?? req.header("X-MediaBrowser-Token");
  if (direct) return direct;

  const authHeader = req.header("Authorization") ?? req.header("X-Emby-Authorization");
  if (authHeader) {
    const match = authHeader.match(/Token="?([^",]+)"?/i);
    if (match?.[1]) return match[1];
  }

  // Image/audio requests are often issued from <img>/<audio> tags which can't set custom
  // headers, so Jellyfin clients fall back to passing the token as a query parameter.
  // Different clients use different casings for this (Finamp/real Jellyfin: "api_key" or
  // "ApiKey"; Feishin's direct-play/Download URL: "apiKey") — accept all three.
  const queryToken = req.query.api_key ?? req.query.ApiKey ?? req.query.apiKey ?? req.query.X_Emby_Token;
  return typeof queryToken === "string" ? queryToken : undefined;
}

/**
 * Some non-Jellyfin-native clients (e.g. foobar2000's mobile app) never call
 * `AuthenticateByName` and instead probe the server with plain HTTP Basic Auth
 * (`Authorization: Basic base64(username:password)`), the same credentials configured for
 * `JELLITE_USERNAME` / `JELLITE_PASSWORD`. Accept that as an alternative to the token check
 * so such clients can log in without any Jellyfin-specific auth flow.
 */
function hasValidBasicAuth(req: Request): boolean {
  const authHeader = req.header("Authorization");
  if (!authHeader?.startsWith("Basic ")) return false;

  let decoded: string;
  try {
    decoded = Buffer.from(authHeader.slice("Basic ".length), "base64").toString("utf8");
  } catch {
    return false;
  }

  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex === -1) return false;

  const username = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);
  return username === config.username && password === config.password;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (hasValidBasicAuth(req)) {
    next();
    return;
  }

  const token = extractToken(req);
  if (!token || token !== config.accessToken) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
