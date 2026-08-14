import { Router } from "express";
import { requireAuth } from "../auth.js";

export const displayPreferencesRouter = Router();
displayPreferencesRouter.use(requireAuth);

/**
 * Web clients (jellyfin-vue, etc.) fetch/save per-client UI settings (e.g. "clientSettings")
 * here on every load. Jellite has no persistent per-user settings storage (readonly DB, see
 * SPEC.md), so we always return an empty-but-valid DisplayPreferencesDto and accept writes
 * without storing them — good enough for clients to boot instead of erroring on a 404.
 */
displayPreferencesRouter.get("/DisplayPreferences/:id", (req, res) => {
  res.json({
    Id: req.params.id,
    ViewType: null,
    SortBy: null,
    IndexBy: null,
    RememberIndexing: false,
    PrimaryImageHeight: 0,
    PrimaryImageWidth: 0,
    CustomPrefs: {},
    ScrollDirection: "Horizontal",
    ShowBackdrop: true,
    RememberSorting: false,
    SortOrder: "Ascending",
    ShowSidebar: false,
    Client: typeof req.query.client === "string" ? req.query.client : null,
  });
});

displayPreferencesRouter.post("/DisplayPreferences/:id", (_req, res) => {
  res.status(204).end();
});
