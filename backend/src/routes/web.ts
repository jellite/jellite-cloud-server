import { Readable } from "node:stream";
import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";

const hopByHopHeaders = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export const webRouter = Router();

webRouter.use((req: Request, res: Response, next: NextFunction) => {
  void proxyFeishin(req, res).catch(next);
});

function rewriteLocation(value: string): string {
  if (!config.feishinUpstreamUrl) return value;

  const upstream = new URL(config.feishinUpstreamUrl);
  const absoluteUpstreamUrl = new RegExp(`^https?://${upstream.hostname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?::\\d+)?`, "i");
  return value.replace(absoluteUpstreamUrl, "");
}

async function proxyFeishin(req: Request, res: Response): Promise<void> {
  if (!config.feishinUpstreamUrl) {
    res.status(502).json({ error: "FEISHIN_UPSTREAM_URL is not configured" });
    return;
  }

  if (req.originalUrl === "/web") {
    res.redirect(302, "/web/");
    return;
  }

  const upstreamUrl = new URL(req.originalUrl, config.feishinUpstreamUrl);
  const upstreamResponse = await fetch(upstreamUrl, {
    method: req.method,
    headers: {
      accept: req.header("Accept") ?? "*/*",
      "accept-encoding": "identity",
      "user-agent": req.header("User-Agent") ?? "Jellite",
    },
    redirect: "manual",
  });

  res.status(upstreamResponse.status);
  upstreamResponse.headers.forEach((value, key) => {
    if (!hopByHopHeaders.has(key.toLowerCase())) {
      res.setHeader(key, key.toLowerCase() === "location" ? rewriteLocation(value) : value);
    }
  });

  if (req.method === "HEAD" || !upstreamResponse.body) {
    res.end();
    return;
  }

  Readable.fromWeb(upstreamResponse.body).pipe(res);
}
