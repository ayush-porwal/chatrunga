/**
 * Downloading an account's picture (a Chess.com avatar, a Lichess flair) so the app shows its own
 * copy: the packaged app's CSP doesn't let the renderer load them from the web. Only from the two
 * image hosts those come from, over https, without cookies or credentials, never following a
 * redirect, within a time limit and a size cap, and only a PNG, JPEG, GIF or WebP that is what it
 * says it is. The request goes through the fetch it is given: the app's is Chromium's, on a session
 * of its own (profile-picture/index.ts).
 */
import { rasterType, type RasterType } from "../picture-bytes";

/** Where account pictures come from: Chess.com's image host and Lichess's asset host. */
const PICTURE_HOSTS = new Set(["images.chesscomfiles.com", "lichess1.org"]);

const REMOTE_PICTURE_MAX_BYTES = 1024 * 1024;
const REMOTE_PICTURE_TIMEOUT_MS = 15_000;

/** The image types accepted, by content type, and the extension each is stored with. */
const PICTURE_EXTENSIONS: Partial<Record<string, string>> & Record<RasterType, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp"
};

/**
 * A Lichess flair's image (lila's `flairSrc`: the asset host, its flair version path, the flair's
 * name). `flair` is checked where it is read (lichess/normalize.ts `flairName`).
 */
export function lichessFlairUrl(flair: string): string {
  return `https://lichess1.org/assets/______5/flair/img/${flair}.webp`;
}

/** `address` as a URL when it is an https address on one of the picture hosts, else throws. */
export function pictureUrl(address: string): URL {
  let url: URL;
  try {
    url = new URL(address);
  } catch (error) {
    throw new Error("Not a web address.", { cause: error });
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    throw new Error("Not a plain https address.");
  if (!PICTURE_HOSTS.has(url.hostname))
    throw new Error(`Pictures aren't fetched from ${url.host}.`);
  return url;
}

export type RemotePicture = { contents: Buffer; extension: string };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Downloads the picture at `address` with `fetch`; rejects with the reason it was refused. */
export async function downloadPicture(
  address: string,
  {
    fetch: fetchImpl,
    timeoutMs = REMOTE_PICTURE_TIMEOUT_MS,
    maxBytes = REMOTE_PICTURE_MAX_BYTES
  }: { fetch: FetchLike; timeoutMs?: number; maxBytes?: number }
): Promise<RemotePicture> {
  const url = pictureUrl(address);
  const response = await fetchImpl(url.href, {
    method: "GET",
    headers: { Accept: Object.keys(PICTURE_EXTENSIONS).join(", ") },
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(timeoutMs)
  });
  try {
    if (!response.ok) throw new Error(`${url.host} answered ${response.status}.`);
    const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    const extension = PICTURE_EXTENSIONS[type];
    if (!extension) throw new Error(`Not a picture the app shows (${type || "no type"}).`);
    if (Number(response.headers.get("content-length")) > maxBytes)
      throw new Error("The picture is too large.");
    const contents = await readCapped(response, maxBytes);
    if (rasterType(contents) !== type) throw new Error(`The picture isn't the ${type} it claims.`);
    return { contents, extension };
  } finally {
    // Whatever wasn't read (a refused answer, the rest of an oversized one) is let go.
    await response.body?.cancel().catch(() => undefined);
  }
}

/** The body, refused once it passes `maxBytes` (whatever its Content-Length said). */
async function readCapped(response: Response, maxBytes: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The picture is empty.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("The picture is too large.");
    }
    chunks.push(value);
  }
  reader.releaseLock();
  if (!size) throw new Error("The picture is empty.");
  return Buffer.concat(chunks);
}
