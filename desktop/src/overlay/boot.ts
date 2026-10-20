/**
 * The scrollr-tv overlay (docs/SCROLLR_TV.md): the real ticker bundle in a
 * plain page, fed by YOUR account. overlay.html loads this; it stands in for
 * Tauri the way src/embed/boot.ts does for the website's bar, except that
 * nothing is faked: every API call the app makes goes to the scrollr-tv
 * server on this page's origin (`/api/...`), which adds the real bearer
 * token, and the SSE stream is relayed the same way. No token is ever in
 * this page; the Authorization header it sends is a placeholder.
 *
 * Query params:
 *   ?bg=transparent|solid          default transparent (OBS / vMix browser
 *                                  sources composite it; only the bar paints)
 *   ?theme=<family>-<light|dark>   default scrollr-dark
 *   ?mode=pages|continuous         default pages
 *   ?keypad=0|1                    the hover keypad (default 0: nothing
 *                                  hovers a broadcast)
 *   ?qr=https://myscrollr.com      a QR code at the right end of the bar, where
 *                                  the clock would be (default: myscrollr.com;
 *                                  ?qr=0 for none)
 *   ?utils=clock,weather           local utility widgets on the edge
 *                                  (default: none with the QR code, else clock)
 *   ?title=Anime%20Mundo           the files widget's page tab, and the
 *   ?tagline=powered%20by%20Scrollr   line under it (defaults: _overlay.json
 *                                  in the files folder)
 *
 * The data widgets are the account's own (`/dashboard` rows); there is
 * nothing to pick here. <html data-ready> once the bar has drawn.
 */
import qrcode from "qrcode-generator";
import { API_BASE, REDIRECT_URI } from "../config";

type Args = Record<string, any>;

const LABEL = "ticker";
const STORE_RID = 1;
const API = "/api";
const params = new URLSearchParams(location.search);
const nativeFetch = window.fetch.bind(window);

// ── Who am I, per the server ───────────────────────────────────────

interface AuthState {
  signedIn: boolean;
  userSub?: string | null;
  expiresAt?: number;
}

async function authState(): Promise<AuthState> {
  try {
    const res = await nativeFetch("/auth/state", { cache: "no-store" });
    return res.ok ? ((await res.json()) as AuthState) : { signedIn: false };
  } catch {
    return { signedIn: false };
  }
}

// ── Store (in memory; seeded from the URL, never saved) ───────────

const theme = /^([a-z-]+)-(light|dark)$/.exec(params.get("theme") ?? "") ?? [null, "scrollr", "dark"];
const QR_DEFAULT = "https://myscrollr.com";
const qrParam = params.get("qr");
const qrUrl = qrParam === "0" || qrParam === "" ? "" : (qrParam ?? QR_DEFAULT);
const utils = [
  ...new Set(
    (params.get("utils") ?? (qrUrl ? "" : "clock"))
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ),
];
const store = new Map<string, unknown>([
  ["scrollr:store-migrated", true],
  [
    "scrollr:settings",
    {
      appearance: { themeFamily: theme[1], themeMode: theme[2] },
      ticker: {
        showTicker: true,
        scrollMode: params.get("mode") === "continuous" ? "continuous" : "pages",
        pageControls: params.get("keypad") === "1",
      },
      widgets: { enabledWidgets: utils, widgetsOnTicker: utils, github: { repos: [] }, pins: [] },
    },
  ],
]);

// ── Events ─────────────────────────────────────────────────────────

const callbacks = new Map<number, (e: unknown) => void>();
const listeners = new Map<number, { event: string; handler: number }>();
let nextId = 1;

function deliver(event: string, payload: unknown) {
  setTimeout(() => {
    for (const [id, l] of listeners) {
      if (l.event === event) callbacks.get(l.handler)?.({ event, id, payload });
    }
  });
}

// ── The QR code: the bar's right end, where the clock would be ────
//
// Drawn by this page, outside the app's tree: the app's bar is narrowed
// by the box's width so pages and chips never run under it. Modules take
// the theme's text colour on the bar's own surface, so it reads in light
// and dark alike. 64 px is small for a code, but an LED wall is not.
const QR_BOX = 72;

function mountQr(url: string) {
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  const n = qr.getModuleCount();
  const size = 56;
  const cell = size / n;
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${(c * cell).toFixed(2)} ${(r * cell).toFixed(2)}h${cell.toFixed(2)}v${cell.toFixed(2)}h-${cell.toFixed(2)}z`;
  }
  const box = document.createElement("a");
  box.id = "qr";
  box.href = url;
  box.target = "_blank";
  box.rel = "noopener";
  box.title = url;
  box.setAttribute(
    "style",
    `position:fixed;top:0;right:0;width:${QR_BOX}px;height:64px;display:flex;align-items:center;justify-content:center;` +
      "background:var(--color-base-150);border-left:1px solid color-mix(in srgb, var(--color-fg) 12%, transparent);box-sizing:border-box;",
  );
  box.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" aria-label="${url}"><path fill="var(--color-fg)" d="${d}"/></svg>`;
  document.body.appendChild(box);
  document.getElementById("root")!.style.width = `calc(100% - ${QR_BOX}px)`;
}

// ── The files widget: the server's folder, as a news widget ───────
//
// docs/SCROLLR_TV.md, "Local file widget". The server watches a folder of
// schedules and notes (`GET /files`). Each file becomes a feed of the
// account's Custom RSS widget (`rss_custom`, added here when the account
// has none), and its lines become headline rows, so the bar shows them
// with the same chips and page cells it uses for news and nothing in the
// ticker had to learn a new kind. A change to a file arrives as CDC
// records on the app's own event bus, as a real feed update would.

interface FileItem { id: string; title: string; detail: string; link: string; at: string | null }
interface FileFeed { file: string; slug: string; name: string; color: string; url: string; items: FileItem[] }
interface FilesState { version: string; overlay?: { mode: "split" | "merged"; title: string; tagline: string }; feeds: FileFeed[] }
type Row = Record<string, unknown>;

// Split mode (the default): every file is a widget of its own, with its own
// page, tab and colour, so the bar cycles area by area. The widget ids are
// not in the server's catalog, so the catalog response is extended with one
// entry per file (`files_<slug>`, source rss) before the app reads it; from
// then on the ticker resolves them like any news widget. Merged mode folds
// every file into the account's Custom RSS widget instead.
const FILE_ID_PREFIX = "files_";
const split = () => files.overlay?.mode !== "merged";
const widgetIdOf = (f: FileFeed) => `${FILE_ID_PREFIX}${f.slug}`;
const feedByWidgetId = (id: string) => files.feeds.find((f) => widgetIdOf(f) === id);

/** What a change to the folder means for the widget list: new, gone, renamed or recoloured files. */
const feedShape = (f: FilesState) => f.feeds.map((x) => `${x.slug}|${x.name}|${x.color}`).join("\n") + `|${f.overlay?.mode}`;

function mergeCatalog(c: Row, f: FilesState): Row {
  if (!split() || !f.feeds.length) return c;
  const widgets = ((c.widgets as Row[] | undefined) ?? []).filter((w) => !String(w.id).startsWith(FILE_ID_PREFIX));
  const extra = f.feeds.map((feed, i) => ({
    id: widgetIdOf(feed),
    name: feed.name,
    description: `From ${feed.file} in the scrollr-tv files folder.`,
    source: "rss",
    category: "news",
    color: feed.color,
    default_config: { feeds: [{ name: feed.name, url: feed.url }] },
    required_tier: "free",
    order: 10_000 + i,
    free_slot: true,
    hidden: true,
  }));
  return { ...c, version: `${c.version}+files-${f.version}`, widgets: [...widgets, ...extra] };
}

// ── The page tab's title and tagline ──────────────────────────────
//
// In Pages mode the files widget's tab reads the first word of the first
// feed's name ("MAIN"), as any news widget's does. `_overlay.json` in the
// files folder (or ?title= / ?tagline=) names it instead, and puts a line
// under it ("powered by Scrollr"). The label is the app's own markup, so
// this watches the bar and rewrites that one tab whenever it is drawn.
function applyTitle() {
  const tagline = params.get("tagline") ?? files.overlay?.tagline ?? "";
  const labels = split()
    ? [...document.querySelectorAll<HTMLElement>(`[data-label^="${FILE_ID_PREFIX}"]`)]
    : [...document.querySelectorAll<HTMLElement>(`[data-label="${FILE_WIDGET}"]`)];
  for (const label of labels) {
    // Split: the tab shows the file's whole name, not its first word.
    // Merged: _overlay.json's title (or ?title=), if any.
    const title = split()
      ? (params.get("title") ?? feedByWidgetId(label.dataset.label ?? "")?.name ?? "")
      : (params.get("title") ?? files.overlay?.title ?? "");
    const name = label.querySelector<HTMLElement>("[data-name]");
    if (name && title) {
      if (name.textContent !== title.toUpperCase()) name.textContent = title.toUpperCase();
      // The tab is narrow: a real title needs the whole row, so the item
      // count beside it goes, and a long one steps down a size.
      label.querySelector('[data-part="chip"]')?.remove();
      name.style.fontSize = title.length > 9 ? "16px" : "";
      name.style.letterSpacing = title.length > 9 ? "0.02em" : "";
    }
    let tag = label.querySelector<HTMLElement>("[data-tagline]");
    if (!tagline) {
      tag?.remove();
      continue;
    }
    if (!tag) {
      tag = document.createElement("span");
      tag.dataset.tagline = "";
      tag.className = "block min-w-0 truncate font-sans text-[10px] font-semibold leading-none tracking-[0.06em] -mt-1";
      tag.style.color = "color-mix(in srgb, var(--accent-ink) 72%, transparent)";
      name?.parentElement?.insertAdjacentElement("afterend", tag);
    }
    if (tag.textContent !== tagline) tag.textContent = tagline;
  }
}

function watchTitle() {
  const root = document.getElementById("root")!;
  new MutationObserver(() => applyTitle()).observe(root, { childList: true, subtree: true });
  applyTitle();
}

const FILES_POLL_MS = 5_000;
const FILES_RESTAMP_MS = 30 * 60_000;
const FILE_WIDGET = "rss_custom";
const FILE_ROW_BASE = -1_000_000;

let files: FilesState = { version: "", feeds: [] };
let fileStamp = new Date().toISOString();

async function fetchFiles(): Promise<FilesState | null> {
  try {
    const res = await nativeFetch("/files", { cache: "no-store" });
    return res.ok ? ((await res.json()) as FilesState) : null;
  } catch {
    return null;
  }
}

/** A stable negative row id per item, so CDC updates hit the same row. */
function rowId(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return FILE_ROW_BASE - (Math.abs(h) % 900_000);
}

/** The files as rss_items rows. `published_at` is null on purpose: the
 *  chip's age cell then reads blank, and the item is current by the rail's
 *  rules (an undated item counts as now). `created_at` is re-stamped on
 *  every change and every half hour so the ticker's horizon never drops them. */
function fileRows(f: FilesState): Row[] {
  return f.feeds.flatMap((feed) =>
    feed.items.map((it) => ({
      id: rowId(`${feed.url}:${it.id}`),
      feed_url: feed.url,
      guid: it.id,
      title: it.title,
      link: it.link,
      description: it.detail,
      source_name: feed.name,
      published_at: null,
      created_at: fileStamp,
      updated_at: fileStamp,
    })),
  );
}

/** The account's dashboard with the files folded in. */
function mergeDashboard(d: Row, f: FilesState): Row {
  if (!f.feeds.length) return d;
  const widgets = [...((d.widgets as Row[] | undefined) ?? [])].filter((w) => !String(w.widget_type).startsWith(FILE_ID_PREFIX));
  const feeds = f.feeds.map((x) => ({ name: x.name, url: x.url }));
  const data = (d.data as Row | undefined) ?? {};
  const rss = ((data.rss as Row[] | undefined) ?? []).filter((r) => !String(r.feed_url).startsWith("scrollr-tv://"));
  if (split()) {
    for (const feed of f.feeds) {
      widgets.push({
        id: rowId(`widget:${feed.url}`),
        widget_type: widgetIdOf(feed),
        enabled: true,
        ticker_enabled: true,
        config: { feeds: [{ name: feed.name, url: feed.url }] },
        created_at: fileStamp,
        updated_at: fileStamp,
      });
    }
    return { ...d, widgets, data: { ...data, rss: [...rss, ...fileRows(f)] } };
  }
  const i = widgets.findIndex((w) => w.widget_type === FILE_WIDGET);
  if (i >= 0) {
    const cfg = (widgets[i].config as Row | undefined) ?? {};
    const own = ((cfg.feeds as Array<{ url?: string }> | undefined) ?? []).filter((x) => !String(x.url).startsWith("scrollr-tv://"));
    widgets[i] = { ...widgets[i], ticker_enabled: true, enabled: true, config: { ...cfg, feeds: [...own, ...feeds] } };
  } else {
    widgets.push({
      id: FILE_ROW_BASE,
      widget_type: FILE_WIDGET,
      enabled: true,
      ticker_enabled: true,
      config: { feeds },
      created_at: fileStamp,
      updated_at: fileStamp,
    });
  }
  return { ...d, widgets, data: { ...data, rss: [...rss, ...fileRows(f)] } };
}

/** Push a change as CDC: deletes for rows that went, upserts for the rest.
 *  The app's CDC hook also refetches /dashboard shortly after, which comes
 *  back through mergeDashboard, so the feed list (a new file) catches up too. */
function pushFileChange(prev: FilesState, next: FilesState) {
  const before = new Map(fileRows(prev).map((r) => [`${r.feed_url}:${r.guid}`, r]));
  files = next;
  fileStamp = new Date().toISOString();
  const after = fileRows(next);
  const records: Row[] = [];
  const seen = new Set<string>();
  for (const r of after) {
    const k = `${r.feed_url}:${r.guid}`;
    seen.add(k);
    records.push({ action: before.has(k) ? "update" : "insert", record: r, changes: {}, metadata: { table_name: "rss_items" } });
  }
  for (const [k, r] of before) {
    if (!seen.has(k)) records.push({ action: "delete", record: r, changes: {}, metadata: { table_name: "rss_items" } });
  }
  if (records.length) deliver("sse-event", { data: records });
}

function watchFiles() {
  setInterval(async () => {
    if (document.hidden) return;
    const next = await fetchFiles();
    if (!next) return;
    if (next.version !== files.version) {
      const reshaped = feedShape(next) !== feedShape(files);
      pushFileChange(files, next);
      // A new, gone, renamed or recoloured file is a catalog change: the app
      // refetches the catalog when the network comes back, so tell it that.
      if (reshaped) window.dispatchEvent(new Event("online"));
      applyTitle();
    }
    else if (Date.now() - Date.parse(fileStamp) > FILES_RESTAMP_MS && next.feeds.length) pushFileChange(files, next);
  }, FILES_POLL_MS);
}

// ── HTTP: the app's plugin-http calls, sent to the server ─────────

interface Req {
  config: Args;
  abort: AbortController;
  reader?: ReadableStreamDefaultReader<Uint8Array>;
}
const reqs = new Map<number, Req>();
const viaServer = (url: string) => (url.startsWith(API_BASE) ? API + url.slice(API_BASE.length) : url);

async function send(rid: number) {
  const r = reqs.get(rid)!;
  const { method, url, headers, data } = r.config;
  const res = await nativeFetch(viaServer(url), {
    method,
    headers,
    body: data ? new Uint8Array(data) : undefined,
    signal: r.abort.signal,
  });
  let resHeaders = [...res.headers];
  const rewrite = (body: Row) => {
    r.reader = new Blob([JSON.stringify(body)]).stream().getReader();
    resHeaders = resHeaders.filter(([k]) => !/^(content-length|etag)$/i.test(k));
  };
  if (res.ok && /\/dashboard(\?|$)/.test(url) && files.feeds.length) {
    // The account's dashboard, with the files folded in (see above).
    rewrite(mergeDashboard((await res.json()) as Row, files));
  } else if (res.ok && /\/catalog(\?|$)/.test(url) && files.feeds.length) {
    // The catalog, with one widget per file (split mode).
    rewrite(mergeCatalog((await res.json()) as Row, files));
  } else {
    r.reader = res.body?.getReader();
  }
  return { status: res.status, statusText: res.statusText, url, headers: resHeaders, rid };
}

async function readBody(rid: number) {
  const chunk = await reqs.get(rid)?.reader?.read();
  if (!chunk || chunk.done) {
    reqs.delete(rid);
    return [1];
  }
  const out = new Uint8Array(chunk.value.length + 1); // last byte 0 = more to come
  out.set(chunk.value);
  return out;
}

// ── SSE: relayed by the server, parsed as sse.rs / web.ts do ──────

let sse: AbortController | null = null;
const emit = (event: string, payload: unknown) => deliver(event, payload);

async function runSse(ctl: AbortController) {
  let backoff = 1;
  while (!ctl.signal.aborted) {
    try {
      const res = await nativeFetch(`${API}/events`, {
        headers: { Accept: "text/event-stream", Authorization: "Bearer overlay" },
        signal: ctl.signal,
      });
      if (res.status === 401) {
        emit("sse-status", { status: "auth-expired" });
        return;
      }
      if (!res.ok || !res.body) {
        emit("sse-status", { status: "error", code: res.status });
      } else {
        emit("sse-status", { status: "connected" });
        backoff = 1;
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += value;
          let at: number;
          while ((at = buf.indexOf("\n\n")) >= 0) {
            const frame = buf.slice(0, at);
            buf = buf.slice(at + 2);
            for (const line of frame.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              try {
                emit("sse-event", JSON.parse(line.slice(6)));
              } catch {
                // not JSON: sse.rs drops these too
              }
            }
          }
        }
      }
    } catch (err) {
      if (ctl.signal.aborted) return;
      emit("sse-status", { status: "disconnected", error: String(err) });
    }
    if (ctl.signal.aborted) return;
    emit("sse-status", { status: "reconnecting" });
    await new Promise((r) => setTimeout(r, backoff * 1000));
    backoff = Math.min(backoff * 2, 30);
  }
}

// ── Tauri stand-in ─────────────────────────────────────────────────

function openTab(url: unknown) {
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) return;
  // The app's sign-in is the server's job; send it to the status page.
  const u = new URL(url);
  window.open(u.searchParams.get("redirect_uri") === REDIRECT_URI ? "/" : url, "_blank", "noopener");
}

async function invoke(cmd: string, args: Args = {}): Promise<unknown> {
  switch (cmd) {
    case "plugin:event|listen": {
      const id = nextId++;
      listeners.set(id, { event: args.event, handler: args.handler });
      return id;
    }
    case "plugin:event|unlisten":
      listeners.delete(args.eventId);
      return;
    case "plugin:event|emit":
    case "plugin:event|emit_to":
      return deliver(args.event, args.payload);

    case "plugin:store|load":
    case "plugin:store|get_store":
      return STORE_RID;
    case "plugin:store|entries":
      return [...store.entries()];
    case "plugin:store|keys":
      return [...store.keys()];
    case "plugin:store|get": {
      const v = store.get(args.key);
      return [v ?? null, v !== undefined];
    }
    case "plugin:store|set":
      store.set(args.key, args.value);
      return;
    case "plugin:store|delete":
      return store.delete(args.key);
    case "plugin:store|save":
    case "plugin:store|reload":
      return;

    case "plugin:http|fetch": {
      const rid = nextId++;
      reqs.set(rid, { config: args.clientConfig, abort: new AbortController() });
      return rid;
    }
    case "plugin:http|fetch_send":
      return send(args.rid);
    case "plugin:http|fetch_read_body":
      return readBody(args.rid);
    case "plugin:http|fetch_cancel":
    case "plugin:http|fetch_cancel_body":
      reqs.get(args.rid)?.abort.abort();
      reqs.delete(args.rid);
      return;

    case "start_sse": {
      sse?.abort();
      sse = new AbortController();
      void runSse(sse);
      return;
    }
    case "stop_sse":
      sse?.abort();
      sse = null;
      return emit("sse-status", { status: "disconnected" });

    case "plugin:shell|open":
      return openTab(args.path);
    case "open_external":
      return openTab(args.url);

    case "plugin:window|get_all_windows":
      return [LABEL];
    case "plugin:window|is_visible":
      return true;
    case "plugin:app|version":
      return __APP_VERSION__;
    case "plugin:app|name":
      return "Scrollr";
    case "list_monitors": {
      const { width, height } = window.screen;
      const scaleFactor = window.devicePixelRatio;
      return [
        {
          name: "Overlay", x: 0, y: 0, width, height, scaleFactor, isPrimary: true,
          physicalX: 0, physicalY: 0,
          physicalWidth: Math.round(width * scaleFactor), physicalHeight: Math.round(height * scaleFactor),
        },
      ];
    }
  }
  // Window, tray, updater, autostart: Rust's work in the app, nothing in a page.
  return null;
}

const w = window as unknown as Record<string, unknown>;
w.__TAURI_INTERNALS__ = {
  metadata: {
    currentWindow: { label: LABEL },
    currentWebview: { label: LABEL, windowLabel: LABEL },
    windows: [{ label: LABEL }],
    webviews: [{ label: LABEL, windowLabel: LABEL }],
  },
  invoke,
  transformCallback(cb: (e: unknown) => void, once = false) {
    const id = nextId++;
    callbacks.set(id, once ? (e) => { callbacks.delete(id); cb(e); } : cb);
    return id;
  },
  unregisterCallback: (id: number) => callbacks.delete(id),
  convertFileSrc: (p: string) => p,
};
w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
  unregisterListener: (_event: string, id: number) => listeners.delete(id),
};

// The app's right-click menu is native; the page keeps the browser's own.
window.addEventListener("contextmenu", (e) => e.stopImmediatePropagation(), true);

// ── Boot ───────────────────────────────────────────────────────────

void Promise.all([authState(), fetchFiles()]).then(([s, f]) => {
  const root = document.getElementById("root")!;
  if (f) files = f;
  if (!s.signedIn) {
    document.documentElement.dataset.source = "signed-out";
    root.innerHTML =
      `<div class="overlay-msg">scrollr-tv is not signed in. Open <a href="/" target="_blank" rel="noopener">${location.origin}/</a> and sign in, then reload this source.</div>`;
    // Poll so the source comes alive on its own once the sign-in lands.
    setTimeout(() => location.reload(), 15_000);
    return;
  }
  // "Signed in", as far as the app can tell: a placeholder token that the
  // server swaps for the real one, far from expiry so the app never tries
  // to refresh it (the server refreshes its own).
  store.set("scrollr:auth", {
    accessToken: "overlay",
    refreshToken: null,
    expiresAt: Date.now() + 10 * 365 * 864e5,
    userSub: s.userSub ?? "overlay",
  });

  const done = () => {
    setTimeout(() => {
      document.documentElement.dataset.source = "live";
      document.documentElement.dataset.ready = "";
    }, 300);
  };
  const mo = new MutationObserver(() => {
    if (!root.childElementCount) return;
    mo.disconnect();
    done();
  });
  mo.observe(root, { childList: true });
  if (qrUrl) mountQr(qrUrl);
  watchFiles();
  watchTitle();
  void import("../main");
});
