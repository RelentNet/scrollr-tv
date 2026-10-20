// scrollr-tv server configuration.
//
// The three Scrollr endpoints are the production ones the shipped desktop app
// uses; the Logto app id is a public PKCE client id (desktop/scripts/dev/setup.mjs
// says the same). Override any of them with the environment for a dev stack.
import os from "node:os";
import path from "node:path";

export const PORT = Number(process.env.SCROLLR_TV_PORT ?? 7331);
export const HOST = process.env.SCROLLR_TV_HOST ?? "127.0.0.1";

export const API_BASE = (process.env.SCROLLR_API_URL ?? "https://api.myscrollr.com").replace(/\/+$/, "");
export const AUTH_ENDPOINT = (process.env.SCROLLR_AUTH_ENDPOINT ?? "https://auth.myscrollr.com").replace(/\/+$/, "");
export const LOGTO_APP_ID = process.env.SCROLLR_LOGTO_APP_ID ?? "6y2wqgvkdqmulthvose81";
export const LOGTO_RESOURCE = process.env.SCROLLR_LOGTO_RESOURCE ?? "https://api.myscrollr.com";

/** The redirect the Logto desktop app already allows; the desktop app uses the same one. */
export const REDIRECT_URI = "http://127.0.0.1:19284/callback";
export const REFRESH_BUFFER_MS = 60_000;

export const USER_AGENT = "scrollr-tv/0.1.0";

/** Where the token file lives: %APPDATA%\scrollr-tv on Windows, ~/.config/scrollr-tv elsewhere. */
export const DATA_DIR =
  process.env.SCROLLR_TV_HOME ??
  (process.platform === "win32"
    ? path.join(process.env.APPDATA ?? os.homedir(), "scrollr-tv")
    : path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "scrollr-tv"));
