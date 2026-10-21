import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * CSSLab's Maia 3 code runs exactly as published: every vendored file (and every ONNX Runtime file
 * the host build copies) still has the hash vendor/csslab-maia/PROVENANCE.md records.
 */
const appDir = fileURLToPath(new URL("../../..", import.meta.url));
const vendorDir = join(appDir, "vendor/csslab-maia");
const ortDist = join(appDir, "node_modules/onnxruntime-web/dist");
const provenance = readFileSync(join(vendorDir, "PROVENANCE.md"), "utf8");

/** The table rows (`| \`file\` | \`sha256\` |`) in the section under `heading`. */
function recorded(heading: "## Files" | "## What is not vendored"): [string, string][] {
  const start = provenance.indexOf(heading);
  const end = provenance.indexOf("\n## ", start + heading.length);
  const text = provenance.slice(start, end === -1 ? undefined : end);
  return [...text.matchAll(/^\| `([^`]+)` \| `([0-9a-f]{64})` \|$/gm)].map(
    ([, file, hash]) => [file, hash] as [string, string]
  );
}

const vendored = recorded("## Files");
const ortFiles = recorded("## What is not vendored");

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split("\\").join("/"));
}

describe("vendored CSSLab Maia 3 files", () => {
  it.each(vendored)("%s is byte-identical to upstream", (file, hash) => {
    expect(sha256(join(vendorDir, file))).toBe(hash);
  });

  it("lists every vendored file", () => {
    const listed = vendored.map(([file]) => file).sort((a, b) => a.localeCompare(b));
    expect(
      filesUnder(vendorDir)
        .filter((file) => file !== "PROVENANCE.md")
        .sort((a, b) => a.localeCompare(b))
    ).toStrictEqual(listed);
  });

  it.each(ortFiles)("onnxruntime-web's %s is CSSLab's public/ort copy", (file, hash) => {
    expect(sha256(join(ortDist, file))).toBe(hash);
  });

  it("records the three ONNX Runtime files the worker loads", () => {
    expect(ortFiles.map(([file]) => file)).toStrictEqual([
      "ort.wasm.min.js",
      "ort-wasm-simd-threaded.mjs",
      "ort-wasm-simd-threaded.wasm"
    ]);
  });
});
