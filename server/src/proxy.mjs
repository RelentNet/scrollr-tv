// /api/* → the Scrollr API, with the server's bearer token added.
//
// The overlay page sends a placeholder Authorization header (its token never
// leaves this process); it is replaced here. Responses stream straight
// through, which is what /events (SSE) needs. A 401 on a GET is retried once
// after a forced refresh.
import { Readable } from "node:stream";
import { API_BASE, USER_AGENT } from "./config.mjs";
import { getAccessToken } from "./auth.mjs";

const HOP = new Set(["host", "connection", "keep-alive", "transfer-encoding", "content-length", "authorization", "accept-encoding"]);
const DROP_RESP = new Set(["content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive"]);

export async function proxy(req, res) {
  const target = API_BASE + req.url.slice("/api".length);
  const method = req.method ?? "GET";
  const hasBody = !["GET", "HEAD"].includes(method);

  const token = await getAccessToken();
  if (!token) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "scrollr-tv is not signed in" }));
    return;
  }

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP.has(k.toLowerCase()) && v !== undefined) headers[k] = Array.isArray(v) ? v.join(", ") : v;
  }
  headers["user-agent"] = USER_AGENT;

  // A body can only be streamed once, so buffer it for the possible retry.
  const body = hasBody ? Buffer.concat(await req.toArray()) : undefined;
  const ctl = new AbortController();
  req.on("close", () => ctl.abort());

  const send = (bearer) =>
    fetch(target, { method, headers: { ...headers, authorization: `Bearer ${bearer}` }, body, signal: ctl.signal, redirect: "manual" });

  let upstream;
  try {
    upstream = await send(token);
    if (upstream.status === 401 && !hasBody) {
      const fresh = await getAccessToken(true);
      if (fresh && fresh !== token) upstream = await send(fresh);
    }
  } catch (err) {
    if (ctl.signal.aborted) return;
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `upstream: ${err.message}` }));
    return;
  }

  const out = {};
  upstream.headers.forEach((v, k) => {
    if (!DROP_RESP.has(k)) out[k] = v;
  });
  if (out["content-type"]?.startsWith("text/event-stream")) out["cache-control"] = "no-cache";
  res.writeHead(upstream.status, out);
  if (!upstream.body || method === "HEAD") {
    res.end();
    return;
  }
  // flushHeaders so SSE clients see the open stream before the first event.
  res.flushHeaders?.();
  Readable.fromWeb(upstream.body).on("error", () => res.destroy()).pipe(res);
}
