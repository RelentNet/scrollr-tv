// The files widget (docs/SCROLLR_TV.md, "Local file widget"): a folder of
// text files that become items on the bar. Edit a file, the bar follows.
//
// Folder: <DATA_DIR>/files, or SCROLLR_TV_FILES / `--files <dir>`. Created
// with two samples on first run.
//
// Formats, one feed per file:
//   name.md / name.txt    first `# Heading` is the feed's name (else the file
//                         name). Each `- ` / `* ` bullet, or each non-empty
//                         line, is an item. "Title — detail", "Title | detail"
//                         or "Title: detail" split into a title and a detail
//                         line. A leading "9:00 AM" / "14:30" is kept in the
//                         title and used to order the day.
//   name.json             { "name": "...", "items": [ { "title", "detail"?,
//                         "at"? ("09:00", "2026-10-21T09:00"), "link"? } ] }
//
// GET /files → { version, feeds: [{ file, name, url, items: [{ id, title,
// detail, link, at }] }] }. `url` is `scrollr-tv://files/<file>`, the
// feed_url the overlay uses as the widget's feed id.
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./config.mjs";

const argDir = (() => {
  const i = process.argv.indexOf("--files");
  return i >= 0 ? process.argv[i + 1] : undefined;
})();
export const FILES_DIR = path.resolve(argDir ?? process.env.SCROLLR_TV_FILES ?? path.join(DATA_DIR, "files"));

const SAMPLES = {
  "schedule.md": `# Schedule

- 9:00 AM Doors open — Main hall
- 10:00 AM Opening panel — Stage A
- 12:00 PM Lunch break — Food court, level 2
- 2:00 PM Cosplay contest — Stage B
- 5:00 PM Closing remarks — Stage A
`,
  "notes.md": `# Notes

- Welcome to the show! Lost and found is at the info desk.
- Wi-Fi: CONVENTION-GUEST, password at registration.
- Photo booth on level 1 is open until 6 PM.
`,
};

// ── Parsing ───────────────────────────────────────────────────────

const TIME = /^\s*((?:[01]?\d|2[0-3]):[0-5]\d\s*(?:[AaPp][Mm])?|(?:1[0-2]|0?[1-9])\s*[AaPp][Mm])\b/;
const SPLIT = /\s+(?:—|–|-{1,2}|\|)\s+|:\s+(?=\S)/;

/** "9:00 AM" / "14:30" → minutes since midnight, or null. */
export function minutesOf(s) {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])?$/.exec(s.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return h * 60 + min;
}

function splitLine(line) {
  const at = TIME.exec(line)?.[1] ?? null;
  const parts = line.split(SPLIT);
  const title = parts[0].trim();
  const detail = parts.slice(1).join(" ").trim();
  return { title, detail, at };
}

export function parseText(name, text) {
  const lines = text.split(/\r?\n/);
  let feedName = name;
  const items = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const h = /^#+\s+(.+)$/.exec(line);
    if (h) {
      if (items.length === 0 && feedName === name) feedName = h[1].trim();
      continue;
    }
    const body = line.replace(/^[-*•]\s+/, "");
    if (!body) continue;
    items.push(splitLine(body));
  }
  return { name: feedName, items };
}

export function parseJson(name, text) {
  const j = JSON.parse(text);
  const items = (Array.isArray(j) ? j : (j.items ?? [])).map((it) =>
    typeof it === "string"
      ? splitLine(it)
      : {
          title: String(it.title ?? it.label ?? ""),
          detail: String(it.detail ?? it.note ?? it.description ?? ""),
          at: it.at != null ? String(it.at) : null,
          link: typeof it.link === "string" ? it.link : undefined,
        },
  );
  return { name: (!Array.isArray(j) && j.name) || j.title || name, items: items.filter((i) => i.title) };
}

/** Items in day order when they carry times (by today's clock), else as written. */
function order(items) {
  const timed = items.map((it, i) => ({ it, i, m: it.at ? minutesOf(it.at.includes("T") ? it.at.slice(11, 16) : it.at) : null }));
  if (!timed.some((t) => t.m !== null)) return items;
  return timed.sort((a, b) => (a.m ?? Infinity) - (b.m ?? Infinity) || a.i - b.i).map((t) => t.it);
}

// ── The folder ────────────────────────────────────────────────────

let cache = { version: "", feeds: [] };
let loading = null;

async function ensureDir() {
  await fsp.mkdir(FILES_DIR, { recursive: true });
  const entries = await fsp.readdir(FILES_DIR);
  if (entries.length === 0) {
    for (const [f, body] of Object.entries(SAMPLES)) await fsp.writeFile(path.join(FILES_DIR, f), body, "utf8");
  }
}

async function load() {
  await ensureDir();
  const names = (await fsp.readdir(FILES_DIR)).filter((f) => /\.(md|txt|json)$/i.test(f) && !f.startsWith(".")).sort();
  const feeds = [];
  const hash = crypto.createHash("sha1");
  for (const file of names) {
    let text;
    try {
      text = await fsp.readFile(path.join(FILES_DIR, file), "utf8");
    } catch {
      continue;
    }
    hash.update(file).update("\0").update(text).update("\0");
    const base = file.replace(/\.[^.]+$/, "");
    let parsed;
    try {
      parsed = /\.json$/i.test(file) ? parseJson(base, text) : parseText(base, text);
    } catch (err) {
      parsed = { name: base, items: [{ title: `${file}: ${err.message}`, detail: "", at: null }] };
    }
    const url = `scrollr-tv://files/${encodeURIComponent(file)}`;
    feeds.push({
      file,
      name: parsed.name,
      url,
      items: order(parsed.items).map((it, i) => ({
        id: `${file}#${i}`,
        title: it.title,
        detail: it.detail ?? "",
        link: it.link ?? "",
        at: it.at ?? null,
      })),
    });
  }
  cache = { version: hash.digest("hex").slice(0, 12), feeds };
  return cache;
}

let watcher = null;
let dirty = true;

export async function filesState() {
  if (dirty || !cache.version) {
    dirty = false;
    loading ??= load().finally(() => (loading = null));
    await loading;
  }
  return cache;
}

/** Start watching; falls back to the per-request mtime check when fs.watch is unavailable. */
export async function startFilesWatcher() {
  await ensureDir();
  try {
    watcher = fs.watch(FILES_DIR, { persistent: false }, () => {
      dirty = true;
    });
    watcher.on("error", () => {
      watcher = null;
    });
  } catch {
    watcher = null;
  }
  // Editors that write via rename, network shares, and the Pi's SD card:
  // a cheap periodic re-read never hurts.
  setInterval(() => (dirty = true), 5_000).unref();
}
