// The files folder: the Notes widget's sources on scrollr-tv.
//
// The server only lists and serves the files; what they mean is the
// ticker's business (desktop/src/widgets/notes/read.ts parses them, on
// every host). Folder: <DATA_DIR>/files, or SCROLLR_TV_FILES / `--files
// <dir>`. Created with two samples on first run.
//
//   GET /files          { files: [{ name, size, mtime }] }  (.md, .txt, .json)
//   GET /files/<name>   the file, as text (CORS open, so the desktop app's
//                       own Notes widget can read it too)
import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./config.mjs";

const argDir = (() => {
  const i = process.argv.indexOf("--files");
  return i >= 0 ? process.argv[i + 1] : undefined;
})();
export const FILES_DIR = path.resolve(argDir ?? process.env.SCROLLR_TV_FILES ?? path.join(DATA_DIR, "files"));

const SAMPLES = {
  "1-schedule.md": `# Schedule

- 9:00 AM Doors open — Main hall
- 10:00 AM Opening panel — Stage A
- 12:00 PM Lunch break — Food court, level 2
- 2:00 PM Cosplay contest — Stage B
- 5:00 PM Closing remarks — Stage A
`,
  "2-notes.md": `# Notes

- Welcome to the show! Lost and found is at the info desk.
- Wi-Fi: CONVENTION-GUEST, password at registration.
- Photo booth on level 1 is open until 6 PM.
`,
};

const OK = /\.(md|txt|markdown|json)$/i;
const MIME = { ".json": "application/json; charset=utf-8", ".md": "text/markdown; charset=utf-8" };

async function ensureDir() {
  await fs.mkdir(FILES_DIR, { recursive: true });
  if ((await fs.readdir(FILES_DIR)).length === 0) {
    for (const [f, body] of Object.entries(SAMPLES)) await fs.writeFile(path.join(FILES_DIR, f), body, "utf8");
  }
}

export async function listFiles() {
  await ensureDir();
  const names = (await fs.readdir(FILES_DIR)).filter((f) => OK.test(f) && !/^[._]/.test(f)).sort();
  const files = [];
  for (const name of names) {
    try {
      const st = await fs.stat(path.join(FILES_DIR, name));
      if (st.isFile()) files.push({ name, size: st.size, mtime: st.mtime.toISOString() });
    } catch {
      // vanished between readdir and stat
    }
  }
  return { files };
}

/** Serve `/files` and `/files/<name>`. Returns false when the path is neither. */
export async function serveFiles(req, res) {
  const u = new URL(req.url, "http://x");
  const cors = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
  if (u.pathname === "/files") {
    res.writeHead(200, { ...cors, "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(await listFiles()));
    return true;
  }
  if (!u.pathname.startsWith("/files/")) return false;
  const name = decodeURIComponent(u.pathname.slice("/files/".length));
  if (!OK.test(name) || name.includes("/") || name.includes("\\") || name.startsWith(".")) {
    res.writeHead(404, cors).end();
    return true;
  }
  try {
    const text = await fs.readFile(path.join(FILES_DIR, name), "utf8");
    res.writeHead(200, { ...cors, "Content-Type": MIME[path.extname(name).toLowerCase()] ?? "text/plain; charset=utf-8" });
    res.end(text);
  } catch {
    res.writeHead(404, cors).end();
  }
  return true;
}
