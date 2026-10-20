// scrollr-tv server (docs/SCROLLR_TV.md).
//
//   /                 status page: signed-in account, overlay URL, sign in / out
//   /auth/state       JSON for the overlay page
//   /auth/login       starts the PKCE sign-in and sends the browser to Logto
//   /auth/logout      (POST) forgets the tokens
//   /api/*            the Scrollr API with this server's bearer token added
//   /overlay/         the built ticker overlay, for OBS, vMix and the Pi
import http from "node:http";
import { spawn } from "node:child_process";
import { HOST, PORT, API_BASE } from "./config.mjs";
import { authState, beginLogin, escapeHtml, logout } from "./auth.mjs";
import { proxy } from "./proxy.mjs";
import { overlayLocation, serveOverlay } from "./static.mjs";
import { tokenFile } from "./tokens.mjs";
import { FILES_DIR, filesState, startFilesWatcher } from "./files.mjs";

const ORIGIN = `http://localhost:${PORT}`;

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function statusPage(res) {
  const s = await authState();
  const files = await filesState();
  const who = s.signedIn ? `Signed in as <code>${escapeHtml(s.userSub ?? "?")}</code>` : "Not signed in";
  const action = s.signedIn
    ? `<form method="post" action="/auth/logout"><button>Sign out</button></form>`
    : `<a class="btn" href="/auth/login">Sign in to Scrollr</a>`;
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>scrollr-tv</title>
<style>
 body{font:15px/1.5 system-ui,sans-serif;background:#141420;color:#e6e6f0;margin:0;padding:40px;max-width:720px}
 h1{font-size:22px;margin:0 0 4px} p{margin:8px 0} code{background:#23233a;padding:2px 6px;border-radius:4px}
 a{color:#7cf2b4} .btn,button{display:inline-block;background:#21c87a;color:#06140d;border:0;border-radius:8px;padding:10px 18px;font-weight:600;text-decoration:none;cursor:pointer;font-size:15px}
 table{border-collapse:collapse;margin-top:16px} td{padding:6px 12px 6px 0;vertical-align:top}
 .muted{color:#9a9ab0}
</style></head><body>
<h1>scrollr-tv</h1>
<p class="muted">The Scrollr bar as a broadcast overlay. Signed in once here; every browser source just points at the URL below.</p>
<p>${who}</p>
<p>${action}</p>
<table>
<tr><td>Overlay</td><td><a href="/overlay/">${ORIGIN}/overlay/</a><br><span class="muted">The bar is exactly <b>64 px</b> tall. OBS: Browser Source <b>1920×64</b> (1280×64 for a 720p canvas), placed at the top of the canvas. vMix: Web Browser input, same size. Nothing else paints, so no transparency is needed; a full-canvas source works too (<code>?bg=transparent</code> is the default). Add <code>?theme=scrollr-light</code>, <code>?mode=continuous</code>, <code>?utils=clock,weather</code>, <code>?bg=solid</code>.</span></td></tr>
<tr><td>API</td><td><code>${ORIGIN}/api/…</code> → <code>${escapeHtml(API_BASE)}</code></td></tr>
<tr><td>Files</td><td><code>${escapeHtml(FILES_DIR)}</code><br><span class="muted">Schedules and notes for the bar: each <code>.md</code>, <code>.txt</code> or <code>.json</code> file here is a feed; edit it and the bar follows within seconds. ${files.feeds.length} file(s), ${files.feeds.reduce((n, f) => n + f.items.length, 0)} item(s) now. <a href="/files">View as JSON</a>.</span></td></tr>
<tr><td>Tokens</td><td><code>${escapeHtml(tokenFile())}</code></td></tr>
<tr><td>Overlay files</td><td><code>${escapeHtml(overlayLocation())}</code></td></tr>
</table>
</body></html>`);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url ?? "/", ORIGIN);
  try {
    if (u.pathname === "/") return await statusPage(res);
    if (u.pathname === "/auth/state") return json(res, 200, await authState());
    if (u.pathname === "/files") return json(res, 200, await filesState());
    if (u.pathname === "/auth/login") {
      const url = await beginLogin(`${ORIGIN}/`);
      res.writeHead(302, { Location: url }).end();
      return;
    }
    if (u.pathname === "/auth/logout" && req.method === "POST") {
      await logout();
      res.writeHead(303, { Location: "/" }).end();
      return;
    }
    if (u.pathname === "/api" || u.pathname.startsWith("/api/")) return await proxy(req, res);
    if (await serveOverlay(req, res)) return;
    res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
  } catch (err) {
    console.error(`[${req.method} ${u.pathname}]`, err);
    if (!res.headersSent) json(res, 500, { error: String(err.message ?? err) });
    else res.destroy();
  }
});

/** Open a URL in the user's default browser; failures are only logged. */
function openBrowser(url) {
  const [cmd, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true }).on("error", () => {}).unref();
  } catch {
    // headless (the Pi): the log line is the way in
  }
}

server.listen(PORT, HOST, async () => {
  const s = await authState();
  await startFilesWatcher();
  console.log(`files       ${FILES_DIR}`);
  console.log(`scrollr-tv  ${ORIGIN}/   (${s.signedIn ? `signed in as ${s.userSub}` : "not signed in — open the URL to sign in"})`);
  console.log(`overlay     ${ORIGIN}/overlay/?bg=transparent`);
  // Signed out: put the status page in front of the user so the first run
  // is "double-click, sign in". `--no-open` for services and the Pi.
  if (!s.signedIn && !process.argv.includes("--no-open") && !process.env.SCROLLR_TV_NO_OPEN) openBrowser(`${ORIGIN}/`);
});
