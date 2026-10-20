// The token file: { accessToken, refreshToken, expiresAt, userSub }.
//
// Written atomically (temp file + rename) and awaited before anything else
// proceeds, for the same reason desktop/src/auth.ts spells out: a refresh
// token can be spent once, so the disk must never hold an older one than the
// one we last sent to Logto.
import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./config.mjs";

const FILE = path.join(DATA_DIR, "auth.json");

let cache = undefined; // undefined = not loaded yet, null = signed out

export async function loadTokens() {
  if (cache !== undefined) return cache;
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const j = JSON.parse(raw);
    cache = typeof j?.accessToken === "string" ? j : null;
  } catch {
    cache = null;
  }
  return cache;
}

export async function saveTokens(state) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  await fs.rename(tmp, FILE);
  cache = state;
}

export async function clearTokens() {
  cache = null;
  await fs.rm(FILE, { force: true });
}

export function tokenFile() {
  return FILE;
}
