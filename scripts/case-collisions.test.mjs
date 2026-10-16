import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

/** Extensions an import may leave out: `./Crosstable` finds `.ts` before `.tsx`. */
const MODULE = /\.(?:[cm]?[jt]sx?|css)$/;

/**
 * Module paths (extension dropped) that differ only in letter case. On a case-insensitive disk
 * (macOS, Windows) an import of one can load the other, which Linux CI never sees.
 */
export function caseCollisions(paths) {
  const seen = new Map();
  const collisions = [];
  for (const path of paths) {
    if (!MODULE.test(path)) continue;
    const base = path.replace(MODULE, "");
    const other = seen.get(base.toLowerCase());
    if (other !== undefined && other !== base) collisions.push([other, base]);
    else seen.set(base.toLowerCase(), base);
  }
  return collisions;
}

test("finds modules whose paths differ only in case", () => {
  assert.deepEqual(
    caseCollisions(["a/Crosstable.tsx", "a/crosstable.ts", "a/b.ts", "a/b.test.ts"]),
    [["a/Crosstable", "a/crosstable"]]
  );
});

test("no two modules in the repository differ only in case", () => {
  const paths = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n");
  assert.deepEqual(caseCollisions(paths), []);
});
