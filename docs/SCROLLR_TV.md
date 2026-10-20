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

## Local file widget (built: schedules and notes for the LED wall)

**The use case:** at a convention, the LED wall shows the day's schedule and
house notes. Edit a text file, the bar follows within seconds.

**How it works.** The server watches a folder (`server/src/files.mjs`:
`%APPDATA%\scrollr-tv\files`, or `--files <dir>` / `SCROLLR_TV_FILES`; two
sample files are written on first run) and serves it as `GET /files`. The
overlay (`src/overlay/boot.ts`, "The files widget") folds those files into the
account's dashboard as feeds of the **Custom RSS** widget (`rss_custom`, added
client-side when the account has none) with each line as a headline row. So
the bar shows them with the same headline chips and page cells it uses for
news, and no shared ticker code changed. A file change is pushed onto the
app's own event bus as CDC records, exactly as a real feed update arrives.

**File formats, one feed per file.** The feed's name is the chip's tab
(SCHEDULE, NOTES).

- `name.md` / `name.txt`: the first `# Heading` is the feed name (else the
  file name). Each `- ` bullet or non-empty line is an item. `Title — detail`,
  `Title | detail` or `Title: detail` split into headline and detail line. A
  leading `9:00 AM` / `14:30` keeps the day in order.
  ```md
  # Schedule
  - 9:00 AM Doors open — Main hall
  - 10:00 AM Opening panel — Stage A
  ```
- `name.json`: `{ "name": "...", "items": [ { "title", "detail"?, "at"?,
  "link"? } ] }`.

**Why not a new widget kind.** A native utility widget (the earlier plan: a
`localfile` folder under `desktop/src/widgets/`, modeled on `github/`) needs
hooks in `useWidgetTickerData`, `widgetPages`, `PagedBar`, `chipColors` and the
ticker's chip roster, all shared files that upstream changes often. Riding the
news renderer keeps the fork's diff to `server/` and `src/overlay/`. The costs:
items rotate through three chip slots like headlines, and the page cell's age
column reads "now" (chips show no age: `published_at` is null on purpose). A
dedicated schedule cell can come later without changing the file format.

## Order of work

1. ~~**Server, auth, proxy.**~~ Done: `server/`, Windows exe.
2. ~~**Overlay page.**~~ Done: `overlay.html`, 1920×64 browser source.
3. ~~**Local file widget.**~~ Done, as above.
4. **Lower third.** Component, WebSocket, control page with show/hide; can
   read entries from the same files folder.
5. **Weather and system monitor on the overlay.** Weather from a city in the
   URL (Open-Meteo works from a browser); sysmon from the server's own OS
   stats (on the Pi, the Pi's).
6. **Pi.** [RelentNet/scrollr-tv#1](https://github.com/RelentNet/scrollr-tv/issues/1).
7. **Upstream merges.** All new code is under `server/` and `src/overlay/`,
   with one Vite mode and one npm script in `desktop/`.

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
