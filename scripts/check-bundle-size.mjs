#!/usr/bin/env node
// Bundle budgets for the built desktop app (apps/desktop/out): what the renderer loads before the
// first screen (the entry and every chunk it imports statically; lazy pages and on-demand chunks
// don't count) and the main process bundle. Exits 1 over a budget, so CI keeps them from growing.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Bytes. Set a little above today's sizes: a real increase fails, noise doesn't. */
export const BUDGETS = {
  rendererStartup: 1_075_000,
  mainEntry: 445_000
};

/** The script tags' chunks in the renderer's index.html. */
export function entryChunks(html) {
  return [...html.matchAll(/<script[^>]*\ssrc="\.\/assets\/([^"]+\.js)"/g)].map(
    (match) => match[1]
  );
}

/**
 * The chunks a chunk loads statically: `import … from "./x.js"` and re-exports
 * (`export … from "./x.js"`), which run their target too; not `import("./x.js")`.
 */
export function staticImports(code) {
  return [
    ...code.matchAll(
      /(?:^|[;}\n])\s*(?:import|export)\s*(?:[\w$*{}\s,]+from\s*)?["']\.\/([^"']+\.js)["']/g
    )
  ].map((match) => match[1]);
}

/** Every chunk loaded with the entries: the static import closure. */
export function startupChunks(entries, readChunk) {
  const seen = new Set();
  const pending = [...entries];
  while (pending.length) {
    const chunk = pending.pop();
    if (chunk === undefined || seen.has(chunk)) continue;
    seen.add(chunk);
    pending.push(...staticImports(readChunk(chunk)));
  }
  return [...seen];
}

/** The measured sizes over their budget, as messages (empty when all fit). */
export function overBudget(sizes, budgets = BUDGETS) {
  return Object.entries(budgets)
    .filter(([name, budget]) => (sizes[name] ?? 0) > budget)
    .map(([name, budget]) => `${name}: ${sizes[name]} bytes (budget ${budget})`);
}

/** The sizes of a built app at `out` (apps/desktop/out). */
export function measureOut(out) {
  const assets = join(out, "renderer", "assets");
  const html = readFileSync(join(out, "renderer", "index.html"), "utf8");
  const startup = startupChunks(entryChunks(html), (chunk) =>
    readFileSync(join(assets, chunk), "utf8")
  );
  return {
    rendererStartup: startup.reduce((sum, chunk) => sum + statSync(join(assets, chunk)).size, 0),
    mainEntry: statSync(join(out, "main", "index.js")).size
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const out = process.argv[2] ?? fileURLToPath(new URL("../apps/desktop/out", import.meta.url));
  if (!existsSync(join(out, "renderer", "index.html"))) {
    console.error(`No built app at ${out}: run pnpm --filter @chaturanga/desktop build first.`);
    process.exit(1);
  }
  const sizes = measureOut(out);
  for (const [name, size] of Object.entries(sizes))
    console.log(`METRIC ${name}=${size} (budget ${BUDGETS[name]})`);
  const over = overBudget(sizes);
  if (over.length) {
    console.error(`Over budget:\n  ${over.join("\n  ")}`);
    process.exit(1);
  }
}
