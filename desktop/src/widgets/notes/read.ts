/**
 * The Notes widget's reader: one text file → one document of items. Pure,
 * no imports, so every host (the desktop app, scrollr-tv's overlay) parses
 * the same way and the tests need no DOM.
 *
 * Formats:
 *   Markdown / text   the first `# Heading` is the document's name (else
 *                     the caller's); each `- ` / `* ` bullet, or each
 *                     non-empty line, is an item. "Title — detail",
 *                     "Title | detail" or "Title: detail" split into the
 *                     title and the detail line. A leading time
 *                     ("9:00 AM", "14:30") is kept in the title and orders
 *                     the day.
 *   JSON              { "name": "...", "items": [ { "title", "detail"?,
 *                     "at"?, "link"? } ] }, or a bare array of either
 *                     strings (parsed as a text line) or those objects.
 */

export interface NoteItem {
  /** Stable within its document: the item's index. */
  id: string;
  title: string;
  /** The line under the title; empty when the file gave none. */
  detail: string;
  /** The time as written ("9:00 AM", "14:30"), or null. */
  at: string | null;
  link: string;
}

export interface NoteDoc {
  name: string;
  items: NoteItem[];
}

const TIME = /^\s*((?:[01]?\d|2[0-3]):[0-5]\d\s*(?:[AaPp][Mm])?|(?:1[0-2]|0?[1-9])\s*[AaPp][Mm])\b/;
// A spaced dash or a pipe splits first; a colon only when there is no dash,
// so "One Piece: Voices of the Grand Line — Main Stage" keeps its subtitle.
const DASH = /\s+(?:—|–|-{1,2}|\|)\s+/;
const COLON = /:\s+(?=\S)/;

/** "9:00 AM" / "14:30" / "2026-10-17T09:00" → minutes since midnight, or null. */
export function minutesOf(at: string | null | undefined): number | null {
  if (!at) return null;
  const s = at.includes("T") ? at.slice(11, 16) : at;
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])?$/.exec(s.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return null;
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return h * 60 + min;
}

function splitLine(line: string): Omit<NoteItem, "id" | "link"> & { link: string } {
  const at = TIME.exec(line)?.[1]?.trim() ?? null;
  const parts = DASH.test(line) ? line.split(DASH) : line.split(COLON);
  return { title: parts[0].trim(), detail: parts.slice(1).join(" ").trim(), at, link: "" };
}

function parseText(name: string, text: string): NoteDoc {
  let docName = name;
  const items: Omit<NoteItem, "id">[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const h = /^#+\s+(.+)$/.exec(line);
    if (h) {
      if (items.length === 0 && docName === name) docName = h[1].trim();
      continue;
    }
    const body = line.replace(/^[-*•]\s+/, "");
    if (!body) continue;
    items.push(splitLine(body));
  }
  return { name: docName, items: withIds(items) };
}

function parseJson(name: string, text: string): NoteDoc {
  const j = JSON.parse(text) as unknown;
  const obj = (v: unknown): Record<string, unknown> | null =>
    v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  const root = obj(j);
  const list = Array.isArray(j) ? j : Array.isArray(root?.items) ? (root!.items as unknown[]) : [];
  const items = list.flatMap((it): Omit<NoteItem, "id">[] => {
    if (typeof it === "string") return [splitLine(it)];
    const o = obj(it);
    if (!o) return [];
    const title = String(o.title ?? o.label ?? "").trim();
    if (!title) return [];
    return [
      {
        title,
        detail: String(o.detail ?? o.note ?? o.description ?? "").trim(),
        at: o.at != null ? String(o.at) : null,
        link: typeof o.link === "string" ? o.link : "",
      },
    ];
  });
  const docName = typeof root?.name === "string" ? root.name : typeof root?.title === "string" ? root.title : name;
  return { name: docName, items: withIds(items) };
}

/** Items in day order when they carry times, else as written. Stable. */
function withIds(items: Omit<NoteItem, "id">[]): NoteItem[] {
  const timed = items.map((it, i) => ({ it, i, m: minutesOf(it.at) }));
  if (timed.some((t) => t.m !== null)) timed.sort((a, b) => (a.m ?? Infinity) - (b.m ?? Infinity) || a.i - b.i);
  return timed.map(({ it, i }) => ({ id: String(i), ...it }));
}

/**
 * Parse `text` as `kind` (from the file's extension, else sniffed: JSON
 * when it starts with `{` or `[`). A JSON document that fails to parse
 * becomes one item saying so, never a crash: the bar must not fabricate,
 * but it may report.
 */
export function parseNotes(name: string, text: string, kind?: "md" | "json"): NoteDoc {
  const k = kind ?? (/^\s*[[{]/.test(text) ? "json" : "md");
  if (k === "json") {
    try {
      return parseJson(name, text);
    } catch (err) {
      return { name, items: [{ id: "0", title: `${name}: ${(err as Error).message}`, detail: "", at: null, link: "" }] };
    }
  }
  return parseText(name, text);
}

/** The kind a URL's file name implies, or undefined to sniff. */
export function kindOf(url: string): "md" | "json" | undefined {
  const m = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(url);
  if (!m) return undefined;
  const ext = m[1].toLowerCase();
  return ext === "json" ? "json" : ext === "md" || ext === "txt" || ext === "markdown" ? "md" : undefined;
}

/** A document's name from its URL when the file names none: "1-main-stage.md" → "main stage". */
export function nameOf(url: string): string {
  let path = url.split(/[?#]/)[0];
  try {
    path = new URL(url).pathname;
  } catch {
    // not absolute: read it as a path
  }
  const last = decodeURIComponent(path.split("/").filter(Boolean).pop() ?? "");
  return last.replace(/\.[^.]+$/, "").replace(/^\d+[-_. ]*/, "").replace(/[-_]+/g, " ").trim() || "Notes";
}
