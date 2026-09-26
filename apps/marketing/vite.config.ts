import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { DOWNLOAD_URL } from "./src/shared/assets";

const publicDir = fileURLToPath(new URL("./public", import.meta.url));

/** Width and height of a baseline or progressive JPEG, read from its SOF marker. */
function jpegSize(file: string): { width: number; height: number } {
  const buf = readFileSync(file);
  let i = 2;
  while (i < buf.length) {
    const marker = buf[i + 1];
    const length = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  throw new Error(`No SOF marker in ${file}`);
}

/** Absolute site origin from env SITE_URL (e.g. https://chaturanga.app), or null when unset. */
function siteUrl(): string | null {
  const raw = process.env.SITE_URL?.trim();
  if (!raw) return null;
  if (!/^https?:\/\/[^/]+/.test(raw)) throw new Error(`SITE_URL must be an absolute http(s) URL, got "${raw}"`);
  return raw.replace(/\/$/, "");
}

/**
 * Link previews need an absolute image URL. Without SITE_URL the Open Graph / Twitter image
 * tags are dropped (a relative URL would just break previews) and the build warns.
 */
function withSiteUrl(html: string, site: string | null): string {
  if (site) return html.replaceAll("%SITE_URL%", site);
  console.warn("[marketing] SITE_URL is not set: omitting og:image/twitter:image (set SITE_URL for link previews).");
  return html.replace(/\s*<meta\b[^>]*(?:og:image|twitter:image)[^>]*\/>/g, "");
}

/**
 * - Replaces %DOWNLOAD_URL% and %SITE_URL% (absolute Open Graph URLs; see withSiteUrl).
 * - Adds width/height to every <img src="/shots/*.jpg"> from the file itself, so re-captured
 *   screenshots never cause layout shift.
 */
function landingHtml(): Plugin {
  return {
    name: "chaturanga-landing-html",
    transformIndexHtml(html) {
      return withSiteUrl(html, siteUrl())
        .replaceAll("%DOWNLOAD_URL%", DOWNLOAD_URL)
        .replace(
          /<img\b([^>]*?)\bsrc="(\/shots\/[^"]+\.jpg)"([^>]*)>/g,
          (tag, before: string, src: string, after: string) => {
            if (/\bwidth=/.test(tag)) return tag;
            const { width, height } = jpegSize(`${publicDir}${src}`);
            return `<img${before}src="${src}" width="${width}" height="${height}"${after}>`;
          }
        );
    }
  };
}

export default defineConfig({
  plugins: [landingHtml()],
  server: {
    host: "127.0.0.1",
    port: 5180
  }
});
