import { Router } from "express";
import { config } from "../config.js";
import { userDto } from "../jellyfinShapes.js";

export const authRouter = Router();

/**
 * Minimal equivalent of Jellyfin's `POST /Users/AuthenticateByName`. Only the single
 * statically configured user (see SPEC.md) is supported; on success we return a fixed,
 * pre-configured access token rather than minting per-session tokens.
 */
authRouter.post("/Users/AuthenticateByName", (req, res) => {
  const { Username, Pw, Password } = req.body ?? {};
  const password = Pw ?? Password;

  if (Username !== config.username || password !== config.password) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  res.json({
    User: userDto(),
    AccessToken: config.accessToken,
    ServerId: config.serverId,
  });
});
