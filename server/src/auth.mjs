// Sign-in: the desktop app's PKCE flow (desktop/src/auth.ts), run by the server.
//
//  1. a one-shot listener on 127.0.0.1:19284 (the redirect Logto already allows)
//  2. the browser goes to Logto's /oidc/auth
//  3. Logto redirects to the listener with a code
//  4. the code is exchanged through the API's /extension/token proxy, exactly
//     as the desktop does, and the tokens are saved to disk
//
// Refresh goes through /extension/token/refresh, one at a time, a minute before
// expiry, and the JWT's own `exp` is preferred over `expires_in` (REL-238).
import crypto from "node:crypto";
import http from "node:http";
import {
  API_BASE,
  AUTH_ENDPOINT,
  LOGTO_APP_ID,
  LOGTO_RESOURCE,
  REDIRECT_URI,
  REFRESH_BUFFER_MS,
  USER_AGENT,
} from "./config.mjs";
import { clearTokens, loadTokens, saveTokens } from "./tokens.mjs";

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function decodeJwt(jwt) {
  try {
    return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function stateFrom(tokens) {
  const payload = decodeJwt(tokens.access_token);
  const exp = typeof payload?.exp === "number" ? payload.exp * 1000 : Date.now() + tokens.expires_in * 1000;
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: exp,
    userSub: typeof payload?.sub === "string" ? payload.sub : null,
    roles: Array.isArray(payload?.roles) ? payload.roles : [],
  };
}

async function postJson(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

// ── Login ─────────────────────────────────────────────────────────

let pending = null; // { server, state, verifier, timer, done: Promise }

/**
 * Start a sign-in. Returns the Logto URL to send the browser to. `onDone` is
 * where the callback page sends the browser afterwards (the status page).
 */
export async function beginLogin(returnTo) {
  if (pending) await cancelLogin();

  const verifier = crypto.randomBytes(64).toString("hex");
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const state = crypto.randomBytes(16).toString("hex");

  const url = new URL(REDIRECT_URI);
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, REDIRECT_URI);
    if (u.pathname !== url.pathname) {
      res.writeHead(404).end();
      return;
    }
    const error = u.searchParams.get("error");
    const code = u.searchParams.get("code");
    const got = u.searchParams.get("state");
    try {
      if (error) throw new Error(u.searchParams.get("error_description") ?? error);
      if (!code || got !== state) throw new Error("bad callback (no code or state mismatch)");
      const tokens = await postJson("/extension/token", { code, redirect_uri: REDIRECT_URI, code_verifier: verifier });
      await saveTokens(stateFrom(tokens));
      res.writeHead(302, { Location: returnTo }).end();
    } catch (err) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><title>Sign-in failed</title><p>Sign-in failed: ${escapeHtml(String(err.message ?? err))}</p><p><a href="${escapeHtml(returnTo)}">Back</a></p>`);
    } finally {
      await cancelLogin();
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", (e) =>
      reject(e.code === "EADDRINUSE" ? new Error("Another application is using the sign-in port (19284). Close it (the Scrollr desktop app's sign-in?) and try again.") : e),
    );
    server.listen(Number(url.port), url.hostname, resolve);
  });

  const timer = setTimeout(() => void cancelLogin(), 15 * 60_000);
  pending = { server, timer };

  const params = new URLSearchParams({
    client_id: LOGTO_APP_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "openid profile email offline_access",
    resource: LOGTO_RESOURCE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    prompt: "consent",
  });
  return `${AUTH_ENDPOINT}/oidc/auth?${params}`;
}

async function cancelLogin() {
  const p = pending;
  pending = null;
  if (!p) return;
  clearTimeout(p.timer);
  await new Promise((r) => p.server.close(() => r()));
}

export async function logout() {
  await clearTokens();
}

// ── Tokens for the proxy ──────────────────────────────────────────

let refreshing = null;

/** A valid access token, refreshed if needed, or null when signed out. */
export async function getAccessToken(force = false) {
  const t = await loadTokens();
  if (!t) return null;
  if (!force && t.expiresAt - Date.now() > REFRESH_BUFFER_MS) return t.accessToken;
  if (!t.refreshToken) {
    await clearTokens();
    return null;
  }
  refreshing ??= refresh(t.refreshToken).finally(() => (refreshing = null));
  return refreshing;
}

async function refresh(refreshToken) {
  try {
    const tokens = await postJson("/extension/token/refresh", { refresh_token: refreshToken });
    const next = stateFrom(tokens);
    // Logto rotates refresh tokens; a response without one keeps the old.
    next.refreshToken ??= refreshToken;
    await saveTokens(next);
    return next.accessToken;
  } catch (err) {
    // A 4xx means the refresh token is dead (expired, revoked, reused): sign out.
    // Anything else (network) keeps the session for a later retry.
    if (/failed: 4\d\d/.test(String(err.message))) {
      console.error("[auth] refresh rejected, signing out:", err.message);
      await clearTokens();
      return null;
    }
    console.error("[auth] refresh failed:", err.message);
    return (await loadTokens())?.accessToken ?? null;
  }
}

export async function authState() {
  const t = await loadTokens();
  if (!t) return { signedIn: false };
  return { signedIn: true, userSub: t.userSub, expiresAt: t.expiresAt, roles: t.roles ?? [] };
}

export function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
