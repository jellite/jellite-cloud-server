import { Router } from "express";
import { serverInfoPublic } from "../jellyfinShapes.js";

export const systemRouter = Router();

// Unauthenticated: used by Jellyfin clients to discover/identify the server before login.
systemRouter.get("/System/Info/Public", (_req, res) => {
  res.json(serverInfoPublic());
});

systemRouter.get("/System/Ping", (_req, res) => {
  res.send("Jellite");
});
