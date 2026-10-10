import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  isInstaller,
  isStockfishAsarEntry,
  isStockfishBinary,
  measureDist
} from "./measure-installer-sizes.mjs";

const scratch = mkdtempSync(join(tmpdir(), "installer-sizes-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

test("installers are the downloadable packages, not update-feed files", () => {
  assert.equal(isInstaller("Chaturanga-0.1.0-mac-arm64.zip"), true);
  assert.equal(isInstaller("Chaturanga-0.1.0-linux-x86_64.AppImage"), true);
  assert.equal(isInstaller("Chaturanga-0.1.0-win-x64-setup.exe"), true);
  assert.equal(isInstaller("latest-mac.yml"), false);
  assert.equal(isInstaller("Chaturanga-0.1.0-mac-arm64.zip.blockmap"), false);
});

test("an asar entry named stockfish is an engine even without a size", () => {
  assert.equal(isStockfishAsarEntry("out/stockfish"), true);
  assert.equal(isStockfishAsarEntry("fixtures/stockfish-wdl.txt"), false);
});

test("a large stockfish file is an engine binary; fixtures and tiny names are not", () => {
  assert.equal(isStockfishBinary("stockfish", 2_000_000), true);
  assert.equal(isStockfishBinary("stockfish.exe", 2_000_000), true);
  assert.equal(isStockfishBinary("stockfish-wdl-italian.txt", 2_000_000), false);
  assert.equal(isStockfishBinary("stockfish", 1000), false);
});

test("measureDist sums installers and flags a binary inside the unpacked app", () => {
  const dist = join(scratch, "dist");
  mkdirSync(join(dist, "mac-arm64", "Chaturanga.app"), { recursive: true });
  writeFileSync(join(dist, "Chaturanga-0.1.0-mac-arm64.zip"), "zip");
  writeFileSync(join(dist, "latest-mac.yml"), "feed");
  writeFileSync(join(dist, "mac-arm64", "Chaturanga.app", "stockfish"), Buffer.alloc(1_000_001));
  const { installers, stockfish } = measureDist(dist);
  assert.deepEqual(
    installers.map((file) => file.name),
    ["Chaturanga-0.1.0-mac-arm64.zip"]
  );
  assert.equal(stockfish.length, 1);
});
