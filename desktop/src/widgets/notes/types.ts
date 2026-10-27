/**
 * The Notes widget's data: fetching a source and the store the ticker and
 * the widget page share.
 *
 * Whoever fetches (the ticker window every NOTES_POLL_S while the widget is
 * on the bar, the widget page while it is open) writes the documents to
 * `LS_NOTES_DOCS`; the other reads them through the store, as Uptime and
 * GitHub do. The chips come from the documents in source order.
 */
import { getStore, setStore } from "../../lib/store";
import { LS_NOTES_DOCS } from "../../constants";
import { barTime } from "../../datawidgets/ticker";
import type { NoteChipData } from "../../types";
import { kindOf, minutesOf, nameOf, parseNotes } from "./read";
import type { NoteDoc } from "./read";
import type { NotesSource } from "./config";

/** Seconds between reads. Not a setting (REL-206). */
export const NOTES_POLL_S = 15;

export interface StoredDoc extends NoteDoc {
  url: string;
  /** Fetch failed: the last good document stays, with the reason. */
  error?: string;
}

export function loadDocs(): StoredDoc[] {
  const docs = getStore<StoredDoc[]>(LS_NOTES_DOCS, []);
  return Array.isArray(docs) ? docs : [];
}

export function saveDocs(docs: StoredDoc[]): void {
  setStore(LS_NOTES_DOCS, docs);
}

/** One source, read and parsed. Throws on a network or HTTP failure. */
export async function fetchDoc(src: NotesSource): Promise<StoredDoc> {
  const res = await fetch(src.url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`.trim());
  const text = await res.text();
  const ct = res.headers.get("content-type") ?? "";
  const kind = kindOf(src.url) ?? (/json/i.test(ct) ? "json" : undefined);
  const doc = parseNotes(nameOf(src.url), text, kind);
  return { ...doc, name: src.name ?? doc.name, url: src.url };
}

/**
 * Every source, in config order. A failing source keeps its last good
 * document (from `previous`) and carries the error; a new one that fails
 * is an empty document with the error, so the page can say so.
 */
export async function fetchDocs(sources: readonly NotesSource[], previous: readonly StoredDoc[] = []): Promise<StoredDoc[]> {
  return Promise.all(
    sources.map(async (src) => {
      try {
        return await fetchDoc(src);
      } catch (err) {
        const last = previous.find((d) => d.url === src.url);
        const error = err instanceof Error ? err.message : String(err);
        return last ? { ...last, error } : { url: src.url, name: src.name ?? nameOf(src.url), items: [], error };
      }
    }),
  );
}

/** "9:00 AM" / "14:30" in the bar's one time format ("9:00A"); other text as written. */
export function atText(at: string | null): string {
  const m = minutesOf(at);
  if (m === null) return at ?? "";
  const d = new Date();
  d.setHours(Math.floor(m / 60), m % 60, 0, 0);
  return barTime(d.getTime());
}

/** The chips, one per item, in document then item order. */
export function noteChips(docs: readonly StoredDoc[]): NoteChipData[] {
  return docs.flatMap((d) =>
    d.items.map((it) => ({
      id: `notes-${d.url}#${it.id}`,
      doc: d.name,
      label: it.title,
      title: it.title,
      detail: it.detail,
      at: atText(it.at),
      url: it.link,
    })),
  );
}
