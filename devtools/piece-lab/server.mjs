#!/usr/bin/env node
/**
 * Piece Lab: a local page for judging the board's piece sets. It shows every set as the working
 * tree's generator would pack it, and reloads itself when a drawing, the generator or the board
 * colours change.
 *
 *   pnpm devtools:pieces          (or: node devtools/piece-lab/server.mjs [--port 5210])
 *
 * Dev only: nothing here is bundled into the app.
 */

import { existsSync, readFileSync, watch } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const repo = resolve(arg("repo", join(here, "../..")));
const port = Number(arg("port", 5210));

const PATHS = {
  generator: "scripts/generate-piece-theme-css.mjs",
  payload: "apps/desktop/src/renderer/src/styles/generated-piece-themes.css.gz",
  settings: "packages/shared/src/types/settings.ts"
};

/** The working tree's generator, re-imported each time so edits to it show without a restart. */
async function generator() {
  const url = pathToFileURL(join(repo, PATHS.generator)).href;
  return import(`${url}?v=${Date.now()}`);
}

/** Board colours, read from the settings source. */
function boardColours(text) {
  const boards = {};
  const block = text.match(/boardThemeSquareColors[^=]*=\s*\{([\s\S]*?)\n\};/)?.[1] ?? "";
  for (const m of block.matchAll(/(\w+): \{ light: "(#\w+)", dark: "(#\w+)" \}/g)) {
    boards[m[1]] = { light: m[2], dark: m[3] };
  }
  return boards;
}

async function data() {
  const gen = await generator();
  const fit = gen.loadFit();
  const working = {};
  for (const heights of gen.HEIGHTS) {
    working[heights] = {};
    for (const theme of gen.THEMES) {
      working[heights][theme] = Object.fromEntries(
        gen.FILES.map(([, , code]) => [code, gen.prepareSvg(theme, code, fit, heights)])
      );
    }
  }
  const packed = existsSync(join(repo, PATHS.payload))
    ? gunzipSync(readFileSync(join(repo, PATHS.payload))).toString("utf8")
    : "";
  return {
    sets: gen.THEMES,
    heights: gen.HEIGHTS,
    boards: boardColours(readFileSync(join(repo, PATHS.settings), "utf8")),
    working,
    // The app reads the packed file, not the generator: flag when they've drifted apart.
    stale: packed !== gen.packedPayload(fit)
  };
}

/* ---------- live reload: Server-Sent Events on any relevant change ---------- */

const clients = new Set();
let pending;
function changed(kind) {
  clearTimeout(pending);
  pending = setTimeout(() => {
    for (const res of clients) res.write(`data: ${kind}\n\n`);
  }, 120);
}
for (const [dir, kind] of [
  [join(repo, "scripts"), "data"],
  [join(repo, "apps/desktop/src/renderer/src/styles"), "data"],
  [join(repo, "packages/shared/src/types"), "data"],
  [here, "page"]
]) {
  watch(dir, { recursive: true }, (_, file) => {
    if (file && !/node_modules|\.test\./.test(file)) changed(kind);
  });
}

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml"
};

async function handle(req, res) {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  if (url.pathname === "/api/data") {
    const body = JSON.stringify(await data());
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(body);
    return;
  }
  if (url.pathname === "/api/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
    res.write(": connected\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const path = join(here, file);
  if (!path.startsWith(here) || !existsSync(path) || file === "server.mjs") {
    res.writeHead(404).end("Not found");
    return;
  }
  res.writeHead(200, {
    "content-type": TYPES[extname(path)] ?? "text/plain",
    "cache-control": "no-store"
  });
  res.end(readFileSync(path));
}

createServer((req, res) => {
  handle(req, res).catch((error) => {
    res.writeHead(500, { "content-type": "text/plain" }).end(String(error?.stack ?? error));
  });
}).listen(port, "127.0.0.1", () => {
  console.log(`Piece Lab on http://localhost:${port}`);
});
