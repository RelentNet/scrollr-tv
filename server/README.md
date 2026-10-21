# scrollr-tv server

Serves the built overlay, runs the one-time Scrollr sign-in and holds the
token, forwards the API, and lists the files folder. It has no ticker, layout
or data logic of its own: what is on the bar is the ticker's (`desktop/src`),
on every host. Design and roadmap: [`docs/SCROLLR_TV.md`](../docs/SCROLLR_TV.md).

| Route | What |
|---|---|
| `/` | status page: account, overlay URL, files folder, sign in / out |
| `/tv/` | the bar, exactly 64 px tall: OBS Browser Source 1920×64 (1280×64 at 720p) at the top of the canvas, or a vMix Web Browser input |
| `/api/*` | the Scrollr API with this server's bearer token added (the SSE stream included) |
| `/files`, `/files/<name>` | the files folder, listed as JSON and served as text (CORS open) |
| `/auth/state`, `/auth/login`, `/auth/logout` | sign-in state and flow |

Overlay query params: `bg=transparent|solid`, `theme=<family>-<light|dark>`,
`mode=pages|continuous`, `keypad=0|1`, `utils=clock,weather`, `notes=0`.

## Run from source

```sh
cd desktop && npm ci && npm run build:tv   # once, and after overlay changes
cd ../server && npm start                   # http://localhost:7331/
```

Zero runtime dependencies; Node 22+. Tokens are kept in
`%APPDATA%\scrollr-tv\auth.json` (Windows) or `~/.config/scrollr-tv/auth.json`;
the files folder is `files/` beside it. Sign-in reuses the desktop app's PKCE
flow and its `127.0.0.1:19284` redirect, so the Logto app needs no change; the
one-shot listener on that port only exists during a sign-in.

Environment overrides: `SCROLLR_TV_PORT` (7331), `SCROLLR_TV_HOST`
(127.0.0.1), `SCROLLR_TV_HOME` (data dir), `SCROLLR_TV_FILES` or `--files
<dir>`, `SCROLLR_API_URL`, `SCROLLR_AUTH_ENDPOINT`, `SCROLLR_LOGTO_APP_ID`,
`SCROLLR_LOGTO_RESOURCE`, `SCROLLR_TV_DIST` (overlay files when not embedded),
`--no-open` / `SCROLLR_TV_NO_OPEN` (no browser on a signed-out start).

## Windows executable

```sh
cd server && npm install && npm run build:win
```

Produces `server/dist/scrollr-tv.exe` (~90 MB: the Node runtime, the server
and the built overlay as embedded assets, via Node's single-executable
application support). Copy it anywhere and run it; no Node needed. The
`signature seems corrupted` warning from postject is expected: the copied
`node.exe` signature is invalidated by the injection and the exe is unsigned.

macOS and Linux (including the Pi's arm64) use the same script on that OS
once Windows is confirmed. Packaging never changes the code.
