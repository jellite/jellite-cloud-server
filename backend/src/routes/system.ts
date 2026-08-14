import { Router } from "express";
import { requireAuth } from "../auth.js";
import { serverInfoPublic } from "../jellyfinShapes.js";

export const systemRouter = Router();

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
