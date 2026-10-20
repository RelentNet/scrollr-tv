# scrollr-tv

A RelentNet fork of [Scrollr](https://github.com/doughknee/myscrollr) (AGPL-3.0)
that runs the desktop app locally against the **production** Scrollr backend,
so you sign in with your real account and get the real sports, finance and news
widgets, and then adds **local file widgets**: a widget whose content comes from
a file on your machine (notes, a schedule, anything), with no server change.

Upstream is the `upstream` git remote. Pull it in with
`git fetch upstream && git merge upstream/main`.

## Running it

### Now: web mode (no Rust, no Docker)

`desktop/.env` already points at production:

```
VITE_API_URL=https://api.myscrollr.com
VITE_AUTH_ENDPOINT=https://auth.myscrollr.com
VITE_LOGTO_APP_ID=6y2wqgvkdqmulthvose81
VITE_LOGTO_RESOURCE=https://api.myscrollr.com
```

Those are the public endpoints and the public PKCE client id the shipped app
uses (`scripts/dev/setup.mjs` lists the same id). `.env` is git-ignored.

```sh
cd desktop
npm ci
npm run web        # http://localhost:5190/web.html
```

One page: the real ticker on top, the real main window below. Sign in with
the Sign In button (Logto opens in a tab and returns to
`http://localhost:5190/callback`). Everything the plugin needs (feed pages,
catalog, ticker chips, preferences) is testable here; see the table in
`docs/LOCAL_SETUP.md` → "Web mode".

### Later: the real Tauri window

Needs, on Windows:

- Rust (`winget install Rustlang.Rustup`, then `rustup default stable-msvc`)
- Visual Studio Build Tools with the "Desktop development with C++" workload
- WebView2 (already present on Windows 11)
- `winget install ezwinports.make` (optional; only for the `make` helpers)

Then `cd desktop && npm run tauri:dev`. Same `.env`, same account.

## Where the plugin plugs in

Scrollr has two kinds of widget (`api/CHANNELS.md`, `docs/VISION.md`):

| Kind | Has `source` | Lives in | Example |
|---|---|---|---|
| Data widget | yes | server row + CDC feed | NFL, Crypto, BBC News |
| Utility widget | no | desktop preferences only | clock, timer, weather, sysmon, uptime, github |

A file widget is a **utility widget**. That matters because the catalog is
server-owned and we do not control production: `GET /catalog` will never list
our widget. The client already handles that case on purpose
(`desktop/src/marketplace.ts`, `isUtilityWidget` and `canonicalOrder`): a widget
id the catalog does not know but `desktop/src/widgets/registry.ts` does is
treated as a local utility and appended to the catalog order. So a new folder
under `desktop/src/widgets/` is enough to make it appear.

`desktop/src/widgets/registry.ts` globs `./*/FeedTab.tsx` and registers every
export named `<id>Widget` that is a `WidgetManifest` (`desktop/src/types/index.ts`).
The `github` widget (`desktop/src/widgets/github/`) is the closest model: it is
local-only, has its own config in `prefs.widgets.github`, polls on its own, and
renders one chip per item on the ticker.

## Design: the `localfile` widget

One widget id, `localfile`. The user adds files; each file becomes a tracked
item (like a tracked repo in the github widget). A file is any of:

- **Markdown** (`.md`, `.txt`): the first heading is the title; each top-level
  bullet or paragraph is a line. Good for notes.
- **JSON** (`.json`) matching a small schema, for structured things like a
  schedule:
  ```json
  { "title": "Today", "items": [
      { "label": "Standup", "at": "2026-10-21T09:00", "note": "zoom" },
      { "label": "Dentist", "at": "2026-10-21T14:30" } ] }
  ```
  Items with `at` sort by time and the ticker shows the next one.
- **ICS** (`.ics`): later, same shape as JSON after parsing.

### Pieces

| Piece | File | Modeled on |
|---|---|---|
| Config (`files: [{path, label, mode}]`, `pollSeconds`) | `desktop/src/widgets/localfile/config.ts` | `widgets/github/config.ts`, wired into `preferences.ts` the same way |
| Reader: `path → {title, items}` | `desktop/src/widgets/localfile/read.ts` | pure, tested with Vitest |
| Feed page: list of files, add/remove, rendered content | `desktop/src/widgets/localfile/FeedTab.tsx` exporting `localfileWidget` | `widgets/github/FeedTab.tsx` |
| Ticker data: one chip per file (title + next line) | `desktop/src/hooks/useWidgetTickerData.ts` (add `localfile`) | the `github` branch there |
| Ticker chip | reuse `components/chips/CappedChip.tsx` or a `NoteChip` | GitHub's per-item chip |
| Page cell (Pages presentation) | `components/pages/widgetPages.ts` + a cell under `components/pages/cells/` | `RepoCell.tsx`; read `docs/CHIP_SPEC.md` §12A first |
| Chip colors | `components/chips/chipColors.ts` | must stay a literal map for Tailwind |

Add `"localfile"` to `WIDGET_ORDER` in `widgets/registry.ts` so it has a
stable place in the Library.

### Reading the file

- **Tauri build**: `@tauri-apps/plugin-fs` reads the path and `watch` fires on
  change, so editing the file updates the ticker live. Needs an `fs` scope
  entry in `desktop/src-tauri/capabilities/` for the user-chosen paths.
- **Web mode**: no filesystem. The feed page accepts a file picker or pasted
  text and keeps it in the widget prefs, so the renderer and ticker can be
  built and tested in the browser before the Tauri toolchain is installed.
  The reader takes a string either way, so the parsing code is shared.

### Order of work

1. `config.ts` + `read.ts` with tests (pure, no UI).
2. `FeedTab.tsx` + registration; it shows up in the Library and the feed in
   web mode.
3. Ticker chip + ticker data hook; it scrolls in web mode.
4. Page cell for the Pages presentation.
5. Tauri fs read + watch once Rust is installed.
6. Keep `git fetch upstream` merges clean: all new code is under
   `widgets/localfile/`, with small hooks in the four shared files above.
