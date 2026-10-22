import { describe, expect, it, vi } from "vitest";
import { downloadPicture, lichessFlairUrl, pictureUrl, type FetchLike } from "./remote-picture";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]);
const AVATAR = "https://images.chesscomfiles.com/uploads/v1/user/1.png";

function answer(body: BodyInit | null, headers: Record<string, string>, status = 200): FetchLike {
  return vi.fn(async () => new Response(body, { status, headers }));
}

describe("pictureUrl", () => {
  it("takes plain https addresses on Chess.com's and Lichess's image hosts only", () => {
    expect(pictureUrl(AVATAR).host).toBe("images.chesscomfiles.com");
    expect(pictureUrl(lichessFlairUrl("objects.crown")).href).toBe(
      "https://lichess1.org/assets/flair/img/objects.crown.webp"
    );
    for (const address of [
      "http://images.chesscomfiles.com/x.png",
      "https://evil.example/x.png",
      "https://images.chesscomfiles.com.evil.example/x.png",
      "https://sub.lichess1.org/x.webp",
      "https://user:pass@lichess1.org/x.webp",
      "https://lichess1.org:8443/x.webp",
      "file:///etc/passwd",
      "not a url"
    ])
      expect(() => pictureUrl(address), address).toThrow(/address|fetched/);
  });
});

describe("downloadPicture", () => {
  it("downloads a picture without cookies, credentials or redirects, within a time limit", async () => {
    const fetch = answer(PNG, {
      "content-type": "image/png",
      "content-length": String(PNG.length)
    });
    const picture = await downloadPicture(AVATAR, { fetch });
    expect(picture).toStrictEqual({ contents: PNG, extension: ".png" });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      AVATAR,
      expect.objectContaining({
        method: "GET",
        credentials: "omit",
        redirect: "error",
        signal: expect.any(AbortSignal)
      })
    );
    await expect(
      downloadPicture(lichessFlairUrl("objects.crown"), {
        fetch: answer(WEBP, { "content-type": "image/webp; charset=binary" })
      })
    ).resolves.toMatchObject({ extension: ".webp" });
  });

  it("never asks a host off the list", async () => {
    const fetch = answer(PNG, { "content-type": "image/png" });
    await expect(downloadPicture("https://example.com/x.png", { fetch })).rejects.toThrow(
      /example\.com/
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses an error answer, a type it doesn't show, or bytes that aren't the type claimed", async () => {
    await expect(
      downloadPicture(AVATAR, { fetch: answer(PNG, { "content-type": "image/png" }, 404) })
    ).rejects.toThrow(/404/);
    for (const type of ["image/svg+xml", "text/html"])
      await expect(
        downloadPicture(AVATAR, { fetch: answer(PNG, { "content-type": type }) }),
        type
      ).rejects.toThrow(/Not a picture/);
    await expect(downloadPicture(AVATAR, { fetch: answer(PNG, {}) })).rejects.toThrow(/no type/);
    await expect(
      downloadPicture(AVATAR, { fetch: answer("<html>", { "content-type": "image/png" }) })
    ).rejects.toThrow(/isn't the image\/png/);
    await expect(
      downloadPicture(AVATAR, { fetch: answer(null, { "content-type": "image/png" }) })
    ).rejects.toThrow(/empty/);
  });

  it("refuses a picture over the size cap, whatever its Content-Length says", async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(64)]);
    await expect(
      downloadPicture(AVATAR, {
        fetch: answer(big, { "content-type": "image/png", "content-length": String(big.length) }),
        maxBytes: 32
      })
    ).rejects.toThrow(/too large/);
    // Streamed without a length (or with a false one): cut off once past the cap.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(PNG));
        controller.enqueue(new Uint8Array(64));
        controller.close();
      }
    });
    await expect(
      downloadPicture(AVATAR, {
        fetch: answer(stream, { "content-type": "image/png", "content-length": "4" }),
        maxBytes: 32
      })
    ).rejects.toThrow(/too large/);
  });

  it("gives up when the host doesn't answer in time", async () => {
    const fetch: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))
      );
    await expect(downloadPicture(AVATAR, { fetch, timeoutMs: 5 })).rejects.toThrow(/timeout/i);
  });
});
