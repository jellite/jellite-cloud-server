import { Router } from "express";
import { requireAuth } from "../auth.js";
import { config } from "../config.js";
import { getTrack } from "../db.js";
import { userDto } from "../jellyfinShapes.js";

export const usersRouter = Router();
usersRouter.use(requireAuth);

usersRouter.get("/Users/:userId", (req, res) => {
  if (req.params.userId !== config.userId) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(userDto());
});

usersRouter.get("/Users/Me", (_req, res) => {
  res.json(userDto());
});

/**
 * Stub favorite endpoints — Finamp calls these on POST (add) / DELETE (remove)
 * (jellyfin_api_helper.dart: addFavourite/removeFavourite) and parses the response as a
 * UserItemDataDto. Jellite intentionally has no persistent favorite state (readonly
 * DB, see SPEC.md), so we just echo back a valid-shaped UserItemDataDto reflecting the
 * requested state without storing anything — good enough so the button in the client
 * doesn't error out, even though the favorite won't survive a refresh/restart.
 */
function respondFavoriteState(req: import("express").Request, res: import("express").Response, isFavorite: boolean) {
  const { itemId } = req.params;
  if (!getTrack(itemId)) {
    res.status(404).json({ error: "Item not found" });
    return;
  }

  res.json({
    PlaybackPositionTicks: 0,
    PlayCount: 0,
    IsFavorite: isFavorite,
    Played: false,
    Key: itemId,
    ItemId: itemId,
  });
}

usersRouter.post("/Users/:userId/FavoriteItems/:itemId", (req, res) => respondFavoriteState(req, res, true));
usersRouter.delete("/Users/:userId/FavoriteItems/:itemId", (req, res) => respondFavoriteState(req, res, false));
