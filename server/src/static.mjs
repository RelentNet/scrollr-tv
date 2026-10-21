// The built overlay (desktop/dist-tv, Vite base /tv/).
//
// Two homes: inside the single-file executable as SEA assets, or on disk
// next to the source for `npm start`.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sea from "node:sea";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

const isSea = sea.isSea();
// In the executable the bundle is CommonJS and import.meta is empty; the
// assets are embedded, so the disk path is only for `npm start`.
const DIST =
  process.env.SCROLLR_TV_DIST ??
  (typeof import.meta.url === "string"
    ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../desktop/dist-tv")
    : path.resolve(process.cwd(), "desktop/dist-tv"));

/** The file at `rel` (posix, no leading slash) as a Buffer, or null. */
async function read(rel) {
  if (isSea) {
    try {
      return Buffer.from(sea.getAsset(`tv/${rel}`));
    } catch {
      return null;
    }
  }
  const abs = path.resolve(DIST, rel);
  if (!abs.startsWith(path.resolve(DIST) + path.sep) && abs !== path.resolve(DIST)) return null;
  try {
    return await fs.readFile(abs);
  } catch {
    return null;
  }
}

/** Serve `/tv/...`. Returns false when the path is not under it. */
export async function serveTv(req, res) {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/tv" || u.pathname === "/overlay" || u.pathname === "/overlay/") {
    res.writeHead(302, { Location: `/tv/${u.search}` }).end();
    return true;
  }
  if (!u.pathname.startsWith("/tv/")) return false;

  let rel = decodeURIComponent(u.pathname.slice("/tv/".length));
  if (rel === "" || rel.endsWith("/")) rel += "tv.html";
  if (rel.split("/").includes("..")) {
    res.writeHead(400).end();
    return true;
  }
  const buf = await read(rel);
  if (!buf) {
    res.writeHead(404, { "Content-Type": "text/plain" }).end(
      isSea ? "not in this build" : `not found; is the overlay built? (npm run build:tv) looked in ${DIST}`,
    );
    return true;
  }
  const ext = path.extname(rel).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME[ext] ?? "application/octet-stream",
    "Cache-Control": rel.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache",
  });
  res.end(buf);
  return true;
}

export function tvLocation() {
  return isSea ? "embedded" : DIST;
}
