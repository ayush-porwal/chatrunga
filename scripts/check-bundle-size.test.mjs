import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  entryChunks,
  measureOut,
  overBudget,
  startupChunks,
  staticImports
} from "./check-bundle-size.mjs";

const scratch = mkdtempSync(join(tmpdir(), "bundle-size-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

test("the entry chunks are the index.html scripts", () => {
  const html =
    '<script type="module" crossorigin src="./assets/index-a1.js"></script>' +
    '<link rel="modulepreload" crossorigin href="./assets/react-b2.js">';
  assert.deepEqual(entryChunks(html), ["index-a1.js"]);
});

test("static imports count; dynamic import() chunks are lazy", () => {
  const code =
    'import{a as e}from"./react-b2.js";import"./side-c3.js";' +
    'const p=()=>import("./GameReviewPage-d4.js");';
  assert.deepEqual(staticImports(code), ["react-b2.js", "side-c3.js"]);
});

test("startup is the static import closure, each chunk once", () => {
  const chunks = {
    "index.js": 'import"./a.js";import"./b.js";const lazy=()=>import("./page.js");',
    "a.js": 'import"./b.js";',
    "b.js": 'import"./a.js";',
    "page.js": ""
  };
  assert.deepEqual(
    startupChunks(["index.js"], (name) => chunks[name]).sort((a, b) => a.localeCompare(b)),
    ["a.js", "b.js", "index.js"]
  );
});

test("only sizes over their budget are reported", () => {
  assert.deepEqual(
    overBudget({ rendererStartup: 10, mainEntry: 5 }, { rendererStartup: 10, mainEntry: 4 }),
    ["mainEntry: 5 bytes (budget 4)"]
  );
  assert.deepEqual(overBudget({ rendererStartup: 10 }, { rendererStartup: 10 }), []);
});

test("measures a built app: startup chunks only, and the main entry", () => {
  const out = join(scratch, "out");
  mkdirSync(join(out, "renderer", "assets"), { recursive: true });
  mkdirSync(join(out, "main"), { recursive: true });
  writeFileSync(
    join(out, "renderer", "index.html"),
    '<script type="module" src="./assets/index.js"></script>'
  );
  writeFileSync(join(out, "renderer", "assets", "index.js"), 'import"./a.js";//' + "x".repeat(70));
  writeFileSync(join(out, "renderer", "assets", "a.js"), "y".repeat(20));
  writeFileSync(join(out, "renderer", "assets", "lazy.js"), "z".repeat(500));
  writeFileSync(join(out, "main", "index.js"), "m".repeat(42));
  // index.js is 87 bytes (17 of import, 70 of padding) and a.js 20; lazy.js isn't loaded at startup.
  assert.deepEqual(measureOut(out), { rendererStartup: 107, mainEntry: 42 });
});
