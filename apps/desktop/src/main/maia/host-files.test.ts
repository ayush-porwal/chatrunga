import { describe, expect, it } from "vitest";
import { MAIA_HOST_CSP, maiaHostHeaders, maiaHostTarget } from "./host-files";

describe("maiaHostTarget", () => {
  it.each([
    ["chaturanga-maia://host/index.html", "index.html", "text/html; charset=utf-8"],
    ["chaturanga-maia://host/maia-worker.js", "maia-worker.js", "text/javascript; charset=utf-8"],
    [
      "chaturanga-maia://host/ort/ort-wasm-simd-threaded.wasm",
      "ort/ort-wasm-simd-threaded.wasm",
      "application/wasm"
    ],
    // A query string or a dot segment doesn't change which listed file is served.
    ["chaturanga-maia://host/ort/../main.js?v=1", "main.js", "text/javascript; charset=utf-8"]
  ])("serves the host build's %s", (url, relativePath, contentType) => {
    expect(maiaHostTarget(url, "GET")).toStrictEqual({ kind: "file", relativePath, contentType });
  });

  it("serves the model at CSSLab's path", () => {
    expect(
      maiaHostTarget("chaturanga-maia://host/maia3/maia3_simplified.onnx", "GET")
    ).toStrictEqual({ kind: "model", contentType: "application/octet-stream" });
  });

  it.each([
    ["an unlisted file", "chaturanga-maia://host/package.json", "GET"],
    ["a path out of the build", "chaturanga-maia://host/%2E%2E/main/index.js", "GET"],
    ["an encoded separator", "chaturanga-maia://host/ort%2Fort.wasm.min.js", "GET"],
    ["an inherited key", "chaturanga-maia://host/constructor", "GET"],
    ["another host", "chaturanga-maia://other/index.html", "GET"],
    ["another scheme", "file:///index.html", "GET"],
    ["a write", "chaturanga-maia://host/index.html", "POST"],
    ["a malformed URL", "not a url", "GET"]
  ])("refuses %s", (_case, url, method) => {
    expect(maiaHostTarget(url, method)).toBeNull();
  });
});

describe("maiaHostHeaders", () => {
  it("sends the host CSP, cross-origin isolation, its type and (for the model) its length", () => {
    const headers = maiaHostHeaders("application/octet-stream", 45_683_686);
    expect(Object.fromEntries(headers)).toStrictEqual({
      "content-length": "45683686",
      "content-security-policy": MAIA_HOST_CSP,
      "content-type": "application/octet-stream",
      "cross-origin-embedder-policy": "require-corp",
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-resource-policy": "same-origin",
      "x-content-type-options": "nosniff"
    });
  });
});
