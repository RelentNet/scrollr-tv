// scrollr-tv server (docs/SCROLLR_TV.md).
//
//   /                 status page: signed-in account, overlay URL, sign in / out
//   /auth/state       JSON for the overlay page
//   /auth/login       starts the PKCE sign-in and sends the browser to Logto
//   /auth/logout      (POST) forgets the tokens
//   /api/*            the Scrollr API with this server's bearer token added
//   /overlay/         the built ticker overlay, for OBS, vMix and the Pi
import http from "node:http";
import { HOST, PORT, API_BASE } from "./config.mjs";
import { authState, beginLogin, escapeHtml, logout } from "./auth.mjs";
import { proxy } from "./proxy.mjs";
import { overlayLocation, serveOverlay } from "./static.mjs";
import { tokenFile } from "./tokens.mjs";

const ORIGIN = `http://localhost:${PORT}`;

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function statusPage(res) {
  const s = await authState();
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
<tr><td>Overlay</td><td><a href="/overlay/?bg=transparent">${ORIGIN}/overlay/?bg=transparent</a><br><span class="muted">OBS: Browser Source, 1920×1080. vMix: Web Browser input. Add <code>&amp;theme=scrollr-light</code>, <code>&amp;mode=continuous</code>, <code>&amp;utils=clock,weather</code>, <code>&amp;bg=solid</code>.</span></td></tr>
<tr><td>API</td><td><code>${ORIGIN}/api/…</code> → <code>${escapeHtml(API_BASE)}</code></td></tr>
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

server.listen(PORT, HOST, async () => {
  const s = await authState();
  console.log(`scrollr-tv  ${ORIGIN}/   (${s.signedIn ? `signed in as ${s.userSub}` : "not signed in — open the URL to sign in"})`);
  console.log(`overlay     ${ORIGIN}/overlay/?bg=transparent`);
});
