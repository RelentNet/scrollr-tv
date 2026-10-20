# scrollr-tv server

Signs in to Scrollr once and serves the broadcast overlay to any browser
source. Design and roadmap: [`docs/SCROLLR_TV.md`](../docs/SCROLLR_TV.md).

| Route | What |
|---|---|
| `/` | status page: account, overlay URL, sign in / out |
| `/overlay/?bg=transparent` | the bar, for OBS (Browser Source, 1920×1080) and vMix (Web Browser input) |
| `/api/*` | the Scrollr API with this server's bearer token added |
| `/auth/state`, `/auth/login`, `/auth/logout` | sign-in state and flow |

Overlay query params: `bg=transparent|solid`, `theme=<family>-<light|dark>`,
`mode=pages|continuous`, `keypad=0|1`, `utils=clock,weather`.

## Run from source

```sh
cd desktop && npm ci && npm run build:overlay   # once, and after overlay changes
cd ../server && npm start                        # http://localhost:7331/
```

Zero runtime dependencies; Node 22+. Tokens are kept in
`%APPDATA%\scrollr-tv\auth.json` (Windows) or `~/.config/scrollr-tv/auth.json`.
Sign-in reuses the desktop app's PKCE flow and its `127.0.0.1:19284` redirect,
so the Logto app needs no change; the one-shot listener on that port only
exists during a sign-in.

Environment overrides: `SCROLLR_TV_PORT` (7331), `SCROLLR_TV_HOST`
(127.0.0.1), `SCROLLR_TV_HOME` (token dir), `SCROLLR_API_URL`,
`SCROLLR_AUTH_ENDPOINT`, `SCROLLR_LOGTO_APP_ID`, `SCROLLR_LOGTO_RESOURCE`,
`SCROLLR_TV_DIST` (overlay files when not embedded).

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
once Windows is confirmed.
