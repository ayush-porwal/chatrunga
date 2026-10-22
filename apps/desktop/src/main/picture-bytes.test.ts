import { describe, expect, it } from "vitest";
import { pngBytes } from "./__fixtures__/picture-bytes";
import { rasterType } from "./picture-bytes";

describe("rasterType", () => {
  it("tells PNG, JPEG, GIF and WebP pictures by their signature", () => {
    expect(rasterType(pngBytes("rest"))).toBe("image/png");
    expect(rasterType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe("image/jpeg");
    expect(rasterType(Buffer.from("GIF89a..."))).toBe("image/gif");
    expect(rasterType(Buffer.from("GIF87a..."))).toBe("image/gif");
    expect(rasterType(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
  });

  it("refuses anything else: text, a cut-off signature, a RIFF that isn't WebP", () => {
    for (const bytes of [
      Buffer.from("png bytes"),
      Buffer.from("<svg/>"),
      Buffer.alloc(0),
      pngBytes().subarray(0, 4),
      Buffer.from("GIF8"),
      Buffer.from("RIFF\0\0\0\0WAVEfmt ")
    ])
      expect(rasterType(bytes)).toBeNull();
  });
});
