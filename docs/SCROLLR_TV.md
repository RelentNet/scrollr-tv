# scrollr-tv

A RelentNet fork of [Scrollr](https://github.com/doughknee/myscrollr) (AGPL-3.0)
that turns the Scrollr bar into a **broadcast overlay**: the real ticker, fed by
your real account on the **production** backend, plus a **lower third**, served as
a plain web page that OBS, vMix and a Raspberry Pi can lay over video. It also
adds **local file widgets**: content from a file on your machine (notes, a
schedule) with no server change. No Tauri build is needed for any of this.

Upstream is the `upstream` git remote. Pull it in with
`git fetch upstream && git merge upstream/main`.

## Targets

| Target | How the overlay gets in | Notes |
|---|---|---|
| OBS | Browser Source → `http://localhost:7331/overlay?bg=transparent`, 1920×1080 | CEF honours the transparent body |
| vMix | Web Browser input, same URL | vMix's browser is Chromium too |
| Raspberry Pi | Chromium kiosk page: HDMI capture full-frame as a `<video>`, bar on top, lower third over it, HDMI out | see "Pi" below |

All three are browsers, so the whole product is **one web page plus one small
local server**. The Tauri desktop app stays untouched for upstream merges.

## What Scrollr already has, and what is missing

- **`desktop/embed.html` + `src/embed/boot.ts`** (served live at
  `myscrollr.com/bar/`): the real ticker bundle in a plain page. But it is
  anonymous: it reads `api.myscrollr.com/public/feed`, not your account, so no
  saved widgets, no custom RSS, no GitHub data, no SSE pushes.
- **`desktop/web.html` + `src/dev/web.ts`** (web mode): the real app in a
  browser with the real Logto sign-in and the real `/dashboard` + SSE. But it
  is dev-only by design: the adapter refuses to run outside `vite dev`, API
  calls go through Vite's `/__api` proxy because the API sends no CORS headers
  for localhost, and the token lives in that browser profile's localStorage,
  which OBS's and vMix's browsers do not share.

So the missing piece is a **buildable browser runtime** whose auth does not live
in the page.

## Design

```
                 sign in once (browser tab, Logto PKCE, redirect → /callback)
                                     │
  ┌──────────────────────────────────▼───────────────────────────────┐
  │  scrollr-tv server   (Node, localhost:7331, runs on PC or Pi)    │
  │   • holds + refreshes the Logto token (file on disk)             │
  │   • /api/*  → api.myscrollr.com with Bearer added (fixes CORS)   │
  │   • /sse    → relays the dashboard SSE stream                    │
  │   • /files  → watches the localfile widget's files               │
  │   • /control UI + WebSocket → show / hide lower thirds           │
  │   • serves the built overlay page                                │
  └──────┬──────────────────────┬───────────────────────┬────────────┘
         │                      │                       │
   OBS browser source     vMix web input        Pi Chromium kiosk
   /overlay?bg=transparent                      /overlay?video=capture
```

The overlay page is a dumb client: no token, no sign-in, no localStorage it
depends on. That is what lets every browser show the same thing.

### Pieces (all under `desktop/` so they share the ticker code)

| Piece | Where | Built on |
|---|---|---|
| Overlay entry | `desktop/overlay.html`, `src/overlay/boot.ts` | `src/embed/boot.ts` for the Tauri stand-in, `src/dev/web.ts` for the real-API path. Vite mode `overlay`, like `build:embed`. |
| Lower third | `src/overlay/LowerThird.tsx` | New. Name/title/strap, in/out animation, themed with the bar's palette. Driven by WebSocket messages from the server. |
| Transparent mode | `?bg=transparent` | `embed.html` hardcodes `#141420`; the overlay leaves the body clear and only the bar and strap paint. |
| Server | `server/` (new top-level package, Node 22) | Logto PKCE sign-in with `http://localhost:7331/callback` as redirect, token store, API proxy, SSE relay, file watcher, control UI. |
| Local file widget | `desktop/src/widgets/localfile/` | utility widget (below); in overlay mode it reads files through the server, in the Tauri app through `plugin-fs`. |

The Logto desktop app already allows `http://localhost:5190/callback` for web
mode. The server's `/callback` on 7331 needs the same allowance on the Logto
app, or the server can run its auth on 5190 to reuse it. Confirm with Brandon.

### Pi

Pi 5 with a USB HDMI capture stick (UVC, 1080p) or a CSI HDMI-in board.
Chromium in kiosk mode opens `/overlay?video=capture`, which renders the
capture device via `getUserMedia` as a full-screen `<video>` with the bar and
lower third on top, and the Pi's HDMI output carries the composite. One page,
no GStreamer. Expected added latency is a few frames from the USB capture.
If that is too much, phase 2 swaps to a GStreamer `compositor` with the overlay
rendered as a transparent browser layer; the overlay page does not change.

The server runs on the Pi too (Node on arm64), so the Pi is self-contained.

## Local file widget

A **utility widget** (`api/CHANNELS.md`, `docs/VISION.md`): no `source`, no
server row, lives in preferences. That matters because the catalog is
server-owned and `GET /catalog` will never list it. The client already handles
that on purpose (`desktop/src/marketplace.ts`: `isUtilityWidget` falls back to
the local registry and `canonicalOrder` appends local ids), so a new folder under
`desktop/src/widgets/` is enough to make it appear in the Library and feed.

`desktop/src/widgets/registry.ts` globs `./*/FeedTab.tsx` and registers every
export named `<id>Widget` that is a `WidgetManifest`. The `github` widget
(`desktop/src/widgets/github/`) is the closest model: local-only, own config in
`prefs.widgets.github`, polls on its own, one chip per item on the ticker.

Widget id `localfile`. Each tracked file becomes an item:

- **Markdown / text**: first heading is the title; top-level bullets or
  paragraphs are lines. Notes.
- **JSON** for structured things like a schedule:
  ```json
  { "title": "Today", "items": [
      { "label": "Standup", "at": "2026-10-21T09:00", "note": "zoom" },
      { "label": "Dentist", "at": "2026-10-21T14:30" } ] }
  ```
  Items with `at` sort by time; the ticker shows the next one. The same JSON
  can also carry lower-third entries (`"lowerThirds": [{ "name", "title" }]`)
  so one file drives both.
- **ICS**: later, parsed into the JSON shape.

| Piece | File | Modeled on |
|---|---|---|
| Config (`files: [{path, label}]`, `pollSeconds`) | `widgets/localfile/config.ts` | `widgets/github/config.ts`, wired into `preferences.ts` the same way |
| Reader `string → {title, items}` | `widgets/localfile/read.ts` | pure, Vitest |
| Feed page | `widgets/localfile/FeedTab.tsx` exporting `localfileWidget` | `widgets/github/FeedTab.tsx` |
| Ticker data | `hooks/useWidgetTickerData.ts` (add `localfile`) | the `github` branch there |
| Ticker chip | reuse `components/chips/CappedChip.tsx` | GitHub's per-item chip |
| Page cell | `components/pages/widgetPages.ts` + a cell in `components/pages/cells/` | `RepoCell.tsx`; read `docs/CHIP_SPEC.md` §12A first |
| Chip colours | `components/chips/chipColors.ts` | literal map, Tailwind scans it |

Add `"localfile"` to `WIDGET_ORDER` in `widgets/registry.ts`.

## Order of work

1. **Server, auth, proxy.** `server/` signs in, stores the token, proxies
   `/api` and `/sse`. Verified by `curl localhost:7331/api/users/me`.
2. **Overlay page.** `overlay.html` showing your account's real bar over a
   transparent body; test in OBS as a Browser Source.
3. **Lower third.** Component, WebSocket, control page with show/hide.
4. **Local file widget.** `config.ts` + `read.ts` with tests, then FeedTab,
   chip, page cell; files served by the server's watcher.
5. **Pi.** Kiosk script, capture `<video>` layer, systemd units for server and
   Chromium.
6. **Upstream merges.** All new code is under `server/`, `src/overlay/` and
   `widgets/localfile/`, with small hooks in the shared files named above.

## Running the desktop app itself (optional)

`desktop/.env` already points at production (public endpoints and the public
PKCE client id from `scripts/dev/setup.mjs`; the file is git-ignored):

```
VITE_API_URL=https://api.myscrollr.com
VITE_AUTH_ENDPOINT=https://auth.myscrollr.com
VITE_LOGTO_APP_ID=6y2wqgvkdqmulthvose81
VITE_LOGTO_RESOURCE=https://api.myscrollr.com
```

- Web mode, no Rust: `cd desktop && npm ci && npm run web` →
  http://localhost:5190/web.html. Sign in with the button.
- Real Tauri window: install Rust (`winget install Rustlang.Rustup`, then
  `rustup default stable-msvc`), Visual Studio Build Tools with the C++
  workload, then `npm run tauri:dev`.
