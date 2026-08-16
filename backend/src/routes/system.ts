import { Router } from "express";
import { requireAuth } from "../auth.js";
import { serverInfoPublic } from "../jellyfinShapes.js";

export const systemRouter = Router();

// Some clients (e.g. foobar2000's mobile app) probe the server with a plain
// `HEAD /` / `GET /` request carrying HTTP Basic Auth credentials before/instead of using the
// Jellyfin API. Without this route it 404s and such clients treat the server as unreachable.
// requireAuth() accepts Basic Auth (see auth.ts), so this doubles as a login check for them.
systemRouter.get("/", requireAuth, (_req, res) => {
  res.sendStatus(200);
});

// foobar2000-mobile also probes with a WebDAV `PROPFIND / (Depth: 0)` request (it appears to
// speculatively check for a WebDAV share before/alongside the Jellyfin API). Jellite isn't a
// WebDAV server, but responding with a minimal, valid single-resource multistatus document
// (rather than 404) lets it get past this probe and proceed to `AuthenticateByName`.
systemRouter.propfind("/", requireAuth, (_req, res) => {
  res
    .status(207)
    .type("application/xml; charset=utf-8")
    .send(
      '<?xml version="1.0" encoding="utf-8"?>' +
        '<D:multistatus xmlns:D="DAV:">' +
        "<D:response>" +
        "<D:href>/</D:href>" +
        "<D:propstat>" +
        "<D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop>" +
        "<D:status>HTTP/1.1 200 OK</D:status>" +
        "</D:propstat>" +
        "</D:response>" +
        "</D:multistatus>",
    );
});

// Unauthenticated: used by Jellyfin clients to discover/identify the server before login.
systemRouter.get("/System/Info/Public", (_req, res) => {
  res.json(serverInfoPublic());
});

systemRouter.get("/System/Ping", (_req, res) => {
  res.send("Jellite");
});

// Authenticated variant of System/Info/Public, requested by some clients (e.g. Feishin)
// after login instead of/in addition to the public one. Same shape is fine here since
// Jellite has no extra admin-only fields worth hiding (single static user, see SPEC.md).
systemRouter.get("/System/Info", requireAuth, (_req, res) => {
  res.json(serverInfoPublic());
});

// Unauthenticated: jellyfin-vue (and other web clients) fetch this right after
// System/Info/Public when adding a server. Jellite has no branding customization, so we
// return the shape's defaults (all fields are optional in Jellyfin's BrandingOptions).
systemRouter.get("/Branding/Configuration", (_req, res) => {
  res.json({ LoginDisclaimer: null, CustomCss: null, SplashscreenEnabled: false });
});

// Unauthenticated: also fetched when adding a server, to show a user-picker before login.
// Jellite's single admin user isn't configured for public sharing (see jellyfinShapes.ts /
// userDto Policy.EnablePublicSharing: false), so mirror real Jellyfin and return an empty
// list — clients fall back to a manual username/password form, which matches Jellite's
// single hardcoded-credential design.
systemRouter.get("/Users/Public", (_req, res) => {
  res.json([]);
});
