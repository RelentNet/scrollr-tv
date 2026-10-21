# scrollr-tv

The Scrollr ticker as a **broadcast overlay**: a signed-in user's own bar,
served as a plain web page to OBS, vMix and a Raspberry Pi, plus a **Notes**
widget that puts schedules and house notes from text files on the bar. Built
for an LED wall at conventions.

Upstream is [doughknee/myscrollr](https://github.com/doughknee/myscrollr), the
`upstream` git remote (`git fetch upstream && git merge upstream/main`).

## The rule

Scrollr runs **one ticker codebase on several hosts** through small adapters:
the desktop app (Tauri), the website's live bar (`desktop/embed.html` +
`src/embed/boot.ts`) and dev web mode (`desktop/web.html` + `src/dev/web.ts`).
Each adapter says where the store, HTTP, SSE and sign-in come from and then
imports `src/main.tsx` unchanged.

**scrollr-tv is one more host of that same ticker.** If a change touches a
chip, a page, a layout or a data fetch, it goes in `desktop/src` for every
host, never in the tv folder or the server.

## The decision

The overlay shows a **signed-in user's own bar** (the web.ts path), not the
website's curated anonymous bar (the embed path). The embed is anonymous,
polls the public feed every 30 s with no live stream and falls back to
fixture headlines; the wall needs the account's widgets and its live pushes.
(Dan, 20 Oct 2026.)

## What is where

| Piece | Where | Modeled on |
|---|---|---|
| Overlay entry | `desktop/tv.html`, `desktop/src/tv/boot.ts`, `src/tv/.env.tv`; Vite mode `tv` (`npm run build:tv` → `dist-tv/`, base `/tv/`) | `embed.html` + `src/embed/boot.ts`, the embed block in `vite.config.ts` |
| Server | `server/` (Node 22, no runtime deps): serves the build, runs the one-time sign-in, holds and refreshes the token, forwards `/api/*` and the SSE stream, lists and serves the files folder as text | the desktop's PKCE flow (`desktop/src/auth.ts`, same `127.0.0.1:19284` redirect, so the Logto app needs no change) |
| Notes widget | `desktop/src/widgets/notes/` (reader, config, data, page), `components/pages/cells/NoteCell.tsx`, and the same hooks the GitHub widget has in `useWidgetTickerData`, `widgetPages`, `PagedBar`, `CappedChip`, `ScrollrTicker`, `chipColors`, `style.css`, `preferences`, `feed.tsx` | the GitHub and Uptime widgets |
| Packaging | `server/scripts/build-win.mjs`: one `scrollr-tv.exe` (Node SEA + postject) with the tv build embedded | — |

### The adapter (`src/tv/boot.ts`)

Stands in for Tauri and nothing else: an in-memory store seeded from the
query string, the app's HTTP calls sent to the server's `/api`, the SSE
stream relayed from `/api/events`, an in-page event table, fixed answers for
windows and monitors. It sends a placeholder bearer; the server swaps in the
real one, so no token is ever in the page. It seeds the Notes widget's
sources from the server's `GET /files` and reloads when that list changes.

Query params: `bg=transparent|solid` (default transparent; the bar paints its
own surface), `theme=<family>-<light|dark>` (default scrollr-dark),
`mode=pages|continuous`, `keypad=0|1` (the hover keypad, a real preference;
default off), `utils=clock,weather` (edge utilities, default clock),
`notes=0` (leave the folder off the bar).

### The Notes widget

A utility widget (no server source), id `notes`, colour `#14b8a6`. Its
config is a list of **URLs** (`prefs.widgets.notes.sources`): a file the
scrollr-tv server serves from its folder, a raw file on GitHub, a shared
drive's direct link. Local paths wait on the Tauri filesystem plugin, which
the app does not ship yet.

- **Reader** (`read.ts`, pure, tested): Markdown or text (first `# Heading`
  names the document; each bullet or line is an item; `Title — detail`,
  `Title | detail` or `Title: detail` split into two lines; a leading time
  orders the day) or JSON (`{ "name", "items": [{ "title", "detail"?, "at"?,
  "link"? }] }`).
- **Data** (`types.ts`): whichever window has the widget reads the sources
  every 15 s and writes the documents to the store; the other window reads
  the store, as Uptime and GitHub do. On tv the ticker is the only window,
  so it reads them itself.
- **Pages**: one page per document, in source order, items as written, one
  tier (a schedule is never re-ranked); a long document runs on to more
  pages; a short one stretches like a GitHub page (`notesPages`). The cell
  (`NoteCell`, min column 300) is three lines, three sizes: the document's
  name in the ink with the item's time right-aligned, the title, the detail
  (mounted blank when none).
- **Continuous**: one capped chip per item, rotating through the capped
  slots like Uptime and GitHub: the document's name as the cap, title over
  detail, the time in the fixed right cell (reserved at 6ch).
- **Band**: `NOTES`, no chip (nothing "happens" in a file). Nothing to show:
  no page and no Also entry, as GitHub.

### Server routes

`/` status page (account, overlay URL, sign in / out, the files folder),
`/auth/state`, `/auth/login`, `/auth/logout`, `/api/*`, `/tv/`, `/files`
(JSON list), `/files/<name>` (the file, CORS open so the desktop app's own
Notes widget can read it). `/overlay` redirects to `/tv/` for sources set up
before the rename.

Files folder: `%APPDATA%\scrollr-tv\files` (Windows) or
`~/.config/scrollr-tv/files`, or `--files <dir>` / `SCROLLR_TV_FILES`. Two
sample files are written on first run. Files sort by name, so
`1-main-stage.md`, `2-gaming-room.md` fixes the order of the pages.

## Targets

| Target | How |
|---|---|
| OBS | Browser Source `http://localhost:7331/tv/`, **1920×64** (1280×64 at 720p), at the top of the canvas. The bar is exactly 64 px tall and paints its own surface, so no transparency is needed; a full-canvas source also works |
| vMix | Web Browser input, same URL and size |
| Raspberry Pi | [RelentNet/scrollr-tv#1](https://github.com/RelentNet/scrollr-tv/issues/1): the server on the Pi, Chromium kiosk, HDMI capture under the bar |

## Running it

```sh
cd desktop && npm ci && npm run build:tv     # the overlay bundle
cd ../server && npm start                     # http://localhost:7331/
```

Sign in once on the status page (it opens on a signed-out start; `--no-open`
for services). Then point OBS at `/tv/`.

Windows executable: `cd server && npm install && npm run build:win` →
`server/dist/scrollr-tv.exe` (about 90 MB, the Node runtime and the overlay
embedded; unsigned). macOS, Linux and the Pi's arm64 use the same script on
that OS once Windows is confirmed. Packaging never changes the code.

## For Brandon's review (spec items, not built)

Three things the wall would like that are **ticker design decisions**, so
they are proposals against `docs/CHIP_SPEC.md`, not code in this fork:

1. **A tagline under the band's name** ("powered by Scrollr") for the Notes
   widget: §P.2 says the name row and pills row are the band; a third line
   is a spec change.
2. **A QR code on the edge zone** (a link to myscrollr.com in place of the
   clock): a new utility per §P.10, with a sizer and a Cycle slot.
3. **A tab and colour per document** on the Notes pages: §7.1 says one
   colour per widget and §P.2 one code per widget. Today every document
   shares `NOTES` and the widget colour, and the cell's kicker names the
   document instead.

Also: `NoteCell` was not drawn on the canvas first (§12A step 4); the
gallery and `cells.spec.ts` entries are still to do.

## Done, and next

1. ~~Server, sign-in, proxy; Windows exe.~~
2. ~~Overlay page as a host of the shared ticker.~~
3. ~~Notes widget, shared.~~
4. Weather and system monitor on the overlay (a city in the URL; sysmon from
   the server's own OS stats).
5. The Pi (issue 1).
