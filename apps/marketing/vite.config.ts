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

/**
 * - Replaces %DOWNLOAD_URL% and %SITE_URL% (env SITE_URL, for absolute Open Graph URLs).
 * - Adds width/height to every <img src="/shots/*.jpg"> from the file itself, so re-captured
 *   screenshots never cause layout shift.
 */
function landingHtml(): Plugin {
  return {
    name: "chaturanga-landing-html",
    transformIndexHtml(html) {
      const site = (process.env.SITE_URL ?? "").replace(/\/$/, "");
      return html
        .replaceAll("%DOWNLOAD_URL%", DOWNLOAD_URL)
        .replaceAll("%SITE_URL%", site)
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
