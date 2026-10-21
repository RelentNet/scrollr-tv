/**
 * The Notes widget's config, kept in `prefs.widgets.notes`: the documents
 * it reads, by URL. A URL is what every host can fetch: a file the
 * scrollr-tv server serves from its folder, a raw file on GitHub, a shared
 * drive's direct link. Local paths wait on the filesystem plugin. Pure: no
 * imports, so preferences.ts can migrate with it.
 */

export interface NotesSource {
  url: string;
  /** Overrides the document's own name (its heading) on the bar. */
  name?: string;
}

export interface NotesWidgetConfig {
  sources: NotesSource[];
}

export const NOTES_DEFAULTS: NotesWidgetConfig = { sources: [] };

/** Documents a widget reads at most; the bar cycles them one page each. */
export const MAX_SOURCES = 12;

const obj = (v: unknown): Record<string, unknown> | undefined =>
  v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

function source(raw: unknown): NotesSource | null {
  const url = typeof raw === "string" ? raw : typeof obj(raw)?.url === "string" ? (obj(raw)!.url as string) : "";
  const u = url.trim();
  if (!/^https?:\/\/\S+$/i.test(u)) return null;
  const name = obj(raw)?.name;
  return typeof name === "string" && name.trim() ? { url: u, name: name.trim() } : { url: u };
}

/** Whatever was stored: a list of URLs or `{url, name}` rows; a bad entry is dropped, never the list. */
export function migrateNotes(raw: unknown): NotesWidgetConfig {
  const list = Array.isArray(raw) ? raw : obj(raw)?.sources;
  if (!Array.isArray(list)) return { sources: [] };
  const seen = new Set<string>();
  const sources: NotesSource[] = [];
  for (const entry of list) {
    const s = source(entry);
    if (s && !seen.has(s.url)) {
      seen.add(s.url);
      sources.push(s);
    }
  }
  return { sources: sources.slice(0, MAX_SOURCES) };
}
