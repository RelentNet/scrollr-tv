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
 *   ?utils=clock,weather           local utility widgets on the edge
 *                                  (default clock)
 *
 * The data widgets are the account's own (`/dashboard` rows); there is
 * nothing to pick here. <html data-ready> once the bar has drawn.
 */
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
const utils = [
  "clock",
  ...(params.get("utils") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s !== "clock"),
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
  r.reader = res.body?.getReader();
  return { status: res.status, statusText: res.statusText, url, headers: [...res.headers], rid };
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

void authState().then((s) => {
  const root = document.getElementById("root")!;
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
  void import("../main");
});
