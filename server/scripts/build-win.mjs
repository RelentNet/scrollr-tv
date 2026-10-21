// Build scrollr-tv.exe: a Node single-executable application (SEA).
//
//   1. desktop: `vite build --mode tv` → desktop/dist-tv
//   2. esbuild bundles server/src → build/server.cjs (SEA needs CommonJS)
//   3. node --experimental-sea-config writes the blob, with every overlay
//      file as an asset
//   4. copy this node.exe to dist/scrollr-tv.exe and inject the blob
//
// Run on Windows with the Node that should ship (node >= 22).
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const desktop = path.resolve(root, "../desktop");
const dist = path.join(desktop, "dist-tv");
const out = path.join(root, "build");
const exeDir = path.join(root, "dist");
const exe = path.join(exeDir, process.platform === "win32" ? "scrollr-tv.exe" : "scrollr-tv");

const run = (cmd, cwd) => {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit" });
};

if (!process.argv.includes("--skip-tv")) run("npm run build:tv", desktop);
if (!fs.existsSync(path.join(dist, "tv.html"))) throw new Error(`no tv build at ${dist}`);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(exeDir, { recursive: true });

await build({
  entryPoints: [path.join(root, "src/index.mjs")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: path.join(out, "server.cjs"),
  logLevel: "info",
});

const assets = {};
const walk = (dir, rel = "") => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), r);
    else assets[`tv/${r}`] = path.join(dir, e.name);
  }
};
walk(dist);

const seaConfig = {
  main: path.join(out, "server.cjs"),
  output: path.join(out, "sea-prep.blob"),
  disableExperimentalSEAWarning: true,
  useCodeCache: false,
  assets,
};
fs.writeFileSync(path.join(out, "sea-config.json"), JSON.stringify(seaConfig, null, 2));
run(`"${process.execPath}" --experimental-sea-config "${path.join(out, "sea-config.json")}"`, root);

fs.copyFileSync(process.execPath, exe);
// postject injects the blob into the copied node binary.
const postject = path.join(root, "node_modules/postject/dist/cli.js");
run(
  `"${process.execPath}" "${postject}" "${exe}" NODE_SEA_BLOB "${seaConfig.output}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2${process.platform === "darwin" ? " --macho-segment-name NODE_SEA" : ""}`,
  root,
);

const mb = (fs.statSync(exe).size / 1048576).toFixed(1);
console.log(`\nbuilt ${exe} (${mb} MB, ${Object.keys(assets).length} overlay files embedded)`);
