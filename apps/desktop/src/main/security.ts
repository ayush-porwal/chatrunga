/**
 * Pure navigation / content-security helpers for the app window (no Electron
 * imports, so they are unit-testable). Wired up in `index.ts`.
 */

/** Links the OS browser may open: plain http(s) only — never file:, javascript:, custom schemes. */
export function isExternalHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Whether `url` is the app's own page: same origin as the dev server in
 * development, or the bundled `index.html` in production. Anything else must
 * not replace the app window.
 */
export function isAppUrl(url: string, appUrl: string): boolean {
  try {
    const target = new URL(url);
    const app = new URL(appUrl);
    if (app.protocol === "file:") return target.protocol === "file:" && target.pathname === app.pathname;
    return target.origin === app.origin;
  } catch {
    return false;
  }
}

/** Only these permission requests are granted to the renderer; everything else is denied. */
const ALLOWED_PERMISSIONS = new Set(["clipboard-sanitized-write"]);

export function isPermissionAllowed(permission: string): boolean {
  return ALLOWED_PERMISSIONS.has(permission);
}

/** CSP for the packaged renderer (dev relies on Vite, whose HMR needs inline scripts / websockets). */
export const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: chaturanga-image:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join("; ");

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico", ".avif"]);

/**
 * Resolves a `chaturanga-image://local/<encoded absolute path>` URL to the
 * image file it names, or null. Only absolute paths with an image extension
 * are served, so the protocol cannot be used to read arbitrary files.
 */
export function localImagePathFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "chaturanga-image:" || parsed.hostname !== "local") return null;
    const path = decodeURIComponent(parsed.pathname.slice(1));
    const isAbsolute = path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path);
    if (!isAbsolute || path.includes("\0")) return null;
    const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
    return IMAGE_EXTENSIONS.has(extension) ? path : null;
  } catch {
    return null;
  }
}
