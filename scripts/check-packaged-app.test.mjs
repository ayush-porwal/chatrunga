import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  archivePath,
  checkArchive,
  checkDist,
  findArchives,
  missingFiles,
  references,
  relativeImports,
  WORKERS
} from "./check-packaged-app.mjs";

const desktop = fileURLToPath(new URL("../apps/desktop/", import.meta.url));
const asar = createRequire(join(desktop, "package.json"))("@electron/asar");
const scratch = mkdtempSync(join(tmpdir(), "check-packaged-app-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

/** A complete app's files, as electron-vite lays them out (hashed chunk names). */
const completeApp = () => ({
  "package.json": "{}",
  "out/main/index.js":
    'import { a } from "./chunks/main-AbC123.js";\nconst load = () => import("./chunks/lazy-XyZ.js");\n',
  "out/main/chunks/main-AbC123.js": "export const a = 1;\n",
  "out/main/chunks/lazy-XyZ.js": "export default 2;\n",
  "out/main/puzzle-scan-worker.js":
    'import { t as reservoirScan } from "./chunks/puzzle-scan-Q1w2E3.js";\nimport { parentPort } from "node:worker_threads";\n',
  "out/main/chunks/puzzle-scan-Q1w2E3.js":
    'import { x } from "./shared-9.js";\nexport const t = x;\n',
  "out/main/chunks/shared-9.js": "export const x = 3;\n",
  "out/main/repertoire-import-worker.js": 'import { x } from "./chunks/shared-9.js";\n',
  "out/main/repertoire-import-writer-worker.js": 'import { c } from "./chunks/core-Mn7.js";\n',
  "out/main/repertoire-backup-restore-worker.js": 'import { c } from "./chunks/core-Mn7.js";\n',
  "out/main/chunks/core-Mn7.js": "export const c = 4;\n",
  "out/preload/index.cjs": 'require("electron");\n',
  "out/renderer/index.html":
    '<!doctype html><link rel="icon" href="data:image/svg+xml,x"><script type="module" src="./assets/index-Ab1.js"></script><link rel="stylesheet" href="./assets/index-Cd2.css">',
  "out/renderer/assets/index-Ab1.js":
    'const page = () => import("./Page-Ef3.js");\nconst deps = ["./Page-Gh4.css"];\nconst sound = new URL("Move-Ij5.mp3", import.meta.url).href;\n',
  "out/renderer/assets/Page-Ef3.js": "export default 1;\n",
  "out/renderer/assets/Page-Gh4.css": ".a{}\n",
  "out/renderer/assets/Move-Ij5.mp3": "ID3",
  "out/renderer/assets/index-Cd2.css":
    '@font-face{src:url("./Font-Kl6.woff2")}.b{background:url(data:image/png;base64,x)}\n',
  "out/renderer/assets/Font-Kl6.woff2": "wOF2"
});

let packages = 0;
/** Packs `files` into `<dir>/resources/app.asar` (dir defaults to a fresh folder). */
async function pack(files, dir = join(scratch, `app-${packages++}`)) {
  const source = join(dir, "source");
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(source, path)), { recursive: true });
    writeFileSync(join(source, path), contents);
  }
  const archive = join(dir, "resources", "app.asar");
  mkdirSync(dirname(archive), { recursive: true });
  await asar.createPackage(source, archive);
  rmSync(source, { recursive: true });
  return archive;
}

const without = (files, ...paths) =>
  Object.fromEntries(Object.entries(files).filter(([path]) => !paths.includes(path)));

test("finds relative imports, not packages or built-ins", () => {
  const source =
    'import a from "./a.js"; import("../b.js"); require("./c.cjs"); import "node:fs"; import x from "electron";';
  assert.deepEqual(relativeImports(source), ["./a.js", "../b.js", "./c.cjs"]);
});

test("looks files up in an archive by the OS's separator (asar can't find out/main/… on Windows)", () => {
  assert.equal(archivePath("out/main/index.js", "\\"), "out\\main\\index.js");
  assert.equal(archivePath("out/main/index.js", "/"), "out/main/index.js");
  assert.equal(archivePath("package.json", "\\"), "package.json");
});

test("a complete package passes", async () => {
  const archive = await pack(completeApp());
  const result = checkArchive(archive);
  assert.deepEqual(result.missing, []);
  assert.equal(result.fileCount > 0, true);
});

test("the puzzle-scan worker is required whatever the local build has", async () => {
  const archive = await pack(without(completeApp(), "out/main/puzzle-scan-worker.js"));
  assert.deepEqual(checkArchive(archive).missing, ["out/main/puzzle-scan-worker.js"]);
});

test("every worker thread main starts by path is required, with the chunks it imports", async () => {
  for (const worker of WORKERS) {
    assert.deepEqual(checkArchive(await pack(without(completeApp(), worker))).missing, [worker]);
  }
  // The import writer and the backup restore share a chunk only workers import.
  assert.deepEqual(
    checkArchive(await pack(without(completeApp(), "out/main/chunks/core-Mn7.js"))).missing,
    ["out/main/chunks/core-Mn7.js"]
  );
});

test("a chunk the worker imports must be packaged, transitively", async () => {
  assert.deepEqual(
    checkArchive(await pack(without(completeApp(), "out/main/chunks/puzzle-scan-Q1w2E3.js")))
      .missing,
    ["out/main/chunks/puzzle-scan-Q1w2E3.js"]
  );
  assert.deepEqual(
    checkArchive(await pack(without(completeApp(), "out/main/chunks/shared-9.js"))).missing,
    ["out/main/chunks/shared-9.js"]
  );
});

test("main's static and lazy chunks must be packaged", async () => {
  const archive = await pack(
    without(completeApp(), "out/main/chunks/lazy-XyZ.js", "out/preload/index.cjs")
  );
  assert.deepEqual(checkArchive(archive).missing, [
    "out/preload/index.cjs",
    "out/main/chunks/lazy-XyZ.js"
  ]);
});

test("missingFiles works on any file source", () => {
  const app = completeApp();
  const files = new Set(Object.keys(app));
  assert.deepEqual(
    missingFiles(files, (path) => app[path]),
    []
  );
});

test("checks every package under dist and fails when one is broken", async () => {
  const dist = join(scratch, "dist");
  await pack(completeApp(), join(dist, "mac-arm64", "Chaturanga.app", "Contents"));
  // Unpacked asar folders aren't searched.
  mkdirSync(
    join(
      dist,
      "mac-arm64",
      "Chaturanga.app",
      "Contents",
      "resources",
      "app.asar.unpacked",
      "app.asar"
    ),
    { recursive: true }
  );
  const quiet = { log: () => {}, error: () => {} };
  assert.equal(findArchives(dist).length, 1);
  assert.equal(checkDist(dist, quiet), true);

  await pack(
    without(completeApp(), "out/main/puzzle-scan-worker.js"),
    join(dist, "linux-unpacked")
  );
  const errors = [];
  assert.equal(checkDist(dist, { log: () => {}, error: (message) => errors.push(message) }), false);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /linux-unpacked.*missing out\/main\/puzzle-scan-worker\.js/);
});

test("an empty dist fails", () => {
  const errors = [];
  assert.equal(
    checkDist(join(scratch, "nothing-here"), {
      log: () => {},
      error: (message) => errors.push(message)
    }),
    false
  );
  assert.match(errors[0], /No packaged app\.asar/);
});

test("finds the files a page, a stylesheet and a renderer script refer to", () => {
  assert.deepEqual(
    references(
      "out/renderer/index.html",
      '<a href="#top"></a><img src="https://x.test/a.png"><script src="./assets/a.js?v=1"></script>'
    ),
    ["./assets/a.js"]
  );
  assert.deepEqual(
    references("out/renderer/assets/a.css", "url(./f.woff2) url(\"data:x\") url('./g.png#h')"),
    ["./f.woff2", "./g.png"]
  );
  const script =
    'import("./b.js"); const d = ["./c.css"]; new URL("s.mp3", import.meta.url); const label = "./not-an-asset";';
  assert.deepEqual(references("out/renderer/assets/a.js", script), ["./b.js", "s.mp3", "./c.css"]);
  // Outside the renderer only imports and asset URLs count (a quoted "./x.js" may be anything).
  assert.deepEqual(references("out/main/index.js", 'const name = "./x.js"; import("./y.js");'), [
    "./y.js"
  ]);
});

test("the renderer's scripts, styles, lazy chunks and assets must be packaged", async () => {
  for (const file of [
    "out/renderer/assets/index-Ab1.js",
    "out/renderer/assets/index-Cd2.css",
    "out/renderer/assets/Page-Ef3.js",
    "out/renderer/assets/Page-Gh4.css",
    "out/renderer/assets/Move-Ij5.mp3",
    "out/renderer/assets/Font-Kl6.woff2"
  ]) {
    const { missing } = checkArchive(await pack(without(completeApp(), file)));
    assert.deepEqual(missing, [file]);
  }
});
