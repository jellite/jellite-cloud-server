import { Router } from "express";
import { requireAuth } from "../auth.js";
import { config } from "../config.js";
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
