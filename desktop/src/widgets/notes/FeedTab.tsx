/**
 * The Notes widget's page: the documents the bar reads (schedules, house
 * notes: a text or JSON file by URL, see read.ts for the format) and what
 * each one holds right now. Add a URL, remove one, see the items.
 *
 * On scrollr-tv the sources are the server's files folder, seeded by the
 * overlay; here they are whatever the user pastes.
 */
import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { StickyNote, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import type { FeedTabProps, WidgetManifest } from "../../types";
import Tooltip from "../../components/Tooltip";
import LoadingGlyph from "../../components/LoadingGlyph";
import { useShell } from "../../shell-context";
import { savePrefs, updateWidgetPrefs } from "../../preferences";
import { useSyncedQuery } from "../../hooks/useSyncedQuery";
import { LS_NOTES_DOCS } from "../../constants";
import { MAX_SOURCES } from "./config";
import type { NotesSource } from "./config";
import { NOTES_POLL_S, atText, fetchDocs, loadDocs, saveDocs } from "./types";
import type { StoredDoc } from "./types";

// ── Widget manifest ─────────────────────────────────────────────

export const notesWidget: WidgetManifest = {
  id: "notes",
  name: "Notes",
  tabLabel: "Notes",
  description: "Schedules and notes from your own text files",
  hex: "#14b8a6",
  icon: StickyNote,
  info: {
    about:
      "The Notes widget puts your own documents on the bar: a schedule, house notes, " +
      "anything in a text, Markdown or JSON file reachable by URL. Each document gets " +
      "its own page; edit the file and the bar follows.",
    usage: [
      "Add a file by URL: a raw file on GitHub, a shared drive's direct link, or a file scrollr-tv serves from its folder.",
      "A `# Heading` names the document; each bullet is an item; `Title — detail` splits into two lines; a leading time orders the day.",
      "Each document is a page on the bar, in the order you add them.",
    ],
  },
  FeedTab: NotesFeedTab,
};

// ── FeedTab ─────────────────────────────────────────────────────

function NotesFeedTab(_props: FeedTabProps) {
  const shell = useShell();
  const queryClient = useQueryClient();
  const sources = shell.prefs.widgets.notes.sources;
  const key = sources.map((s) => s.url).join("\n");

  const [input, setInput] = useState("");

  const { data: docs, error, isLoading, isFetching } = useSyncedQuery<StoredDoc>({
    storeKey: LS_NOTES_DOCS,
    loadFn: loadDocs,
    saveFn: saveDocs,
    queryKey: ["notes-docs", key],
    queryFn: () => fetchDocs(sources, loadDocs()),
    enabled: sources.length > 0,
    pollInterval: NOTES_POLL_S,
  });

  const write = useCallback(
    (next: NotesSource[]) => {
      const prefs = updateWidgetPrefs(shell.prefs, "notes", { sources: next });
      shell.onPrefsChange(prefs);
      savePrefs(prefs);
    },
    [shell],
  );

  const add = useCallback(() => {
    const url = input.trim();
    if (!/^https?:\/\/\S+$/i.test(url)) {
      toast.error("Enter a http(s) URL to a .md, .txt or .json file");
      return;
    }
    if (sources.some((s) => s.url === url)) {
      toast.error("Already added");
      return;
    }
    if (sources.length >= MAX_SOURCES) {
      toast.error(`At most ${MAX_SOURCES} documents`);
      return;
    }
    write([...sources, { url }]);
    setInput("");
  }, [input, sources, write]);

  const remove = useCallback(
    (url: string) => {
      write(sources.filter((s) => s.url !== url));
      saveDocs(loadDocs().filter((d) => d.url !== url));
    },
    [sources, write],
  );

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["notes-docs", key] });
  }, [queryClient, key]);

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-mono font-semibold text-widget-notes/80 uppercase tracking-wider">Notes</span>
        <Tooltip content="Read the files again">
          <button onClick={refresh} aria-label="Refresh documents" className="text-xs font-mono text-widget-notes/70 hover:text-widget-notes">
            {isFetching ? <LoadingGlyph size={12} /> : <RefreshCw size={12} />}
          </button>
        </Tooltip>
      </div>

      <div className="flex gap-2">
        <input
          type="url"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder="https://… /schedule.md"
          className="min-w-0 flex-1 text-xs font-mono px-3 py-2 rounded-lg bg-surface-2 border border-edge text-fg placeholder:text-fg-4 focus:border-widget-notes/50 focus:outline-none"
        />
        <button
          onClick={add}
          disabled={!input.trim()}
          className="text-xs font-mono font-semibold text-widget-notes px-3 py-2 rounded-lg bg-widget-notes/10 border border-widget-notes/25 hover:bg-widget-notes/15 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Add
        </button>
      </div>

      {sources.length === 0 && (
        <p className="px-1 text-[11px] font-mono text-fg-3">
          No documents yet. Add a text, Markdown or JSON file by URL; each becomes a page on the bar.
        </p>
      )}
      {error && <p className="px-1 text-[11px] font-mono text-error">{error.message}</p>}
      {isLoading && sources.length > 0 && docs.length === 0 && (
        <p className="px-1 text-[11px] font-mono text-fg-3">Reading…</p>
      )}

      {sources.map((src) => {
        const doc = docs.find((d) => d.url === src.url);
        return (
          <section key={src.url} className="rounded-lg border border-edge bg-surface-2 p-3 space-y-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-mono font-semibold text-fg truncate">{src.name ?? doc?.name ?? src.url}</span>
              <span className="text-[10px] font-mono text-fg-4 truncate" title={src.url}>
                {src.url}
              </span>
              <span className="ml-auto text-[10px] font-mono text-fg-4 shrink-0">{doc ? `${doc.items.length} item${doc.items.length === 1 ? "" : "s"}` : ""}</span>
              <Tooltip content="Remove">
                <button onClick={() => remove(src.url)} aria-label={`Remove ${src.url}`} className="text-fg-3 hover:text-error shrink-0">
                  <X size={12} />
                </button>
              </Tooltip>
            </div>
            {doc?.error && <p className="text-[11px] font-mono text-error">{doc.error}</p>}
            {doc && doc.items.length > 0 && (
              <ul className="space-y-1">
                {doc.items.map((it) => (
                  <li key={it.id} className="flex items-baseline gap-2 text-xs min-w-0">
                    <span className="font-mono text-[11px] text-fg-3 tabular-nums w-[6ch] shrink-0">{atText(it.at)}</span>
                    <span className="font-semibold text-fg truncate">{it.title}</span>
                    {it.detail && <span className="text-fg-3 truncate">{it.detail}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
