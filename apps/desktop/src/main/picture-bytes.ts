/**
 * What a raster picture's bytes say it is, by how they begin (its signature): PNG, JPEG, GIF or
 * WebP. Checked on a picture you upload (picture-store.ts) and on one downloaded for an account
 * (profile-picture/remote-picture.ts), so a renamed or mislabelled file isn't kept as a picture.
 * Loaded on demand: the main bundle doesn't carry it.
 */
import type { RasterType } from "@chaturanga/shared/types/pictures";

const ascii = (bytes: Buffer, start: number, end: number) =>
  bytes.subarray(start, end).toString("latin1");

/** The raster type `bytes` hold, or null when they aren't one of them. */
export function rasterType(bytes: Buffer): RasterType | null {
  if (ascii(bytes, 0, 8) === "\x89PNG\r\n\x1a\n") return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return "image/gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  return null;
}

/** A PNG's width and height, from its header (IHDR, the first chunk); null when there is none. */
export function pngSize(bytes: Buffer): { width: number; height: number } | null {
  if (rasterType(bytes) !== "image/png" || bytes.length < 24) return null;
  if (ascii(bytes, 12, 16) !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** The file extension a raster type is stored under. */
export const RASTER_EXTENSIONS: Record<RasterType, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp"
};
