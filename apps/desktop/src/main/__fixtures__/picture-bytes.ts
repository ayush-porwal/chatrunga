/** A PNG's signature followed by `text`: bytes that pass the raster check (picture-bytes.ts). */
export function pngBytes(text = ""): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(text)
  ]);
}

/** A PNG's signature and header (IHDR) for a `width` × `height` picture, then `text`. */
export function pngOfSize(width: number, height: number, text = ""): Buffer {
  const header = Buffer.alloc(25);
  header.writeUInt32BE(13, 0);
  header.write("IHDR", 4, "latin1");
  header.writeUInt32BE(width, 8);
  header.writeUInt32BE(height, 12);
  return Buffer.concat([pngBytes(), header, Buffer.from(text)]);
}
