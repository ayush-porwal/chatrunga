import { MAIA_HOST_SCHEME, MAIA_MODEL_URL_PATH } from "../../maia-host/protocol";

/**
 * What the Maia host page may load (no Electron imports, so it is unit-testable; served by
 * maia-host.ts). Only these files, from the host build (out/maia-host, see
 * electron.vite.config.ts), at the paths CSSLab's code asks for them by, plus the model.
 */
const HOST_FILES: Readonly<Record<string, string>> = {
  "/index.html": "text/html; charset=utf-8",
  "/main.js": "text/javascript; charset=utf-8",
  // CSSLab's worker (`new Worker('/maia-worker.js')`), and the ONNX Runtime files it loads from
  // `/ort/` (importScripts, then the runtime's own import() and wasm fetch).
  "/maia-worker.js": "text/javascript; charset=utf-8",
  "/ort/ort.wasm.min.js": "text/javascript; charset=utf-8",
  "/ort/ort-wasm-simd-threaded.mjs": "text/javascript; charset=utf-8",
  "/ort/ort-wasm-simd-threaded.wasm": "application/wasm"
};

/**
 * The host page's CSP, on every response (a worker takes its policy from its own script's
 * response). Same-origin scripts only; 'wasm-unsafe-eval' lets ONNX Runtime compile its wasm;
 * same-origin fetches only (the wasm and the model).
 */
export const MAIA_HOST_CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'"
].join("; ");

export type MaiaHostTarget =
  | { kind: "file"; relativePath: string; contentType: string }
  | { kind: "model"; contentType: string }
  | null;

/** The file a host request names, or null (anything else is refused). */
export function maiaHostTarget(url: string, method: string): MaiaHostTarget {
  if (method !== "GET") return null;
  let pathname: string;
  try {
    const parsed = new URL(url);
    // (Not `origin`: the URL standard gives a custom scheme's URLs an opaque "null" origin.)
    if (parsed.protocol !== `${MAIA_HOST_SCHEME}:` || parsed.host !== "host") return null;
    pathname = parsed.pathname;
  } catch {
    return null;
  }
  if (pathname === MAIA_MODEL_URL_PATH)
    return { kind: "model", contentType: "application/octet-stream" };
  const contentType = Object.hasOwn(HOST_FILES, pathname) ? HOST_FILES[pathname] : undefined;
  return contentType ? { kind: "file", relativePath: pathname.slice(1), contentType } : null;
}

/**
 * Response headers for a served file; the model's length lets CSSLab's worker show progress.
 * Every response makes the host cross-origin isolated, as CSSLab's site is (their next.config.js
 * sends the same COOP / COEP pair on every path): with SharedArrayBuffer available, ONNX Runtime
 * runs its threaded wasm (~0.1 s per position instead of ~0.27 s single-threaded). Every file is
 * same-origin, and says so (CORP), so `require-corp` lets the page, worker and runtime load them.
 */
export function maiaHostHeaders(contentType: string, contentLength?: number): Headers {
  const headers = new Headers({
    "Content-Type": contentType,
    "Content-Security-Policy": MAIA_HOST_CSP,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff"
  });
  if (contentLength !== undefined) headers.set("Content-Length", String(contentLength));
  return headers;
}
