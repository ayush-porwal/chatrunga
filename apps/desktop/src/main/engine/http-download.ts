import { createWriteStream, statSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isAllowedDownloadUrl, type FetchLike } from "./github-releases";

/**
 * Streams a URL to a file, resuming an existing partial file with an HTTP Range request.
 *
 * - Every hop (the URL and each redirect target) must be on `allowedHosts`; redirects are
 *   followed manually so a redirect off the allow-list is rejected before any byte is read.
 * - The total size comes from the server (Content-Range on a 206, Content-Length on a 200);
 *   `expectedBytes` is only the progress estimate until then. A partial is never thrown away
 *   because it is larger than some listed size: the server decides (416 → already complete
 *   when it matches the reported total, otherwise start over).
 * - A download that ends short of the reported total throws and keeps the partial, so the next
 *   attempt resumes.
 */

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class DisallowedUrlError extends Error {
  constructor(url: string) {
    super(`Refusing to download from ${safeOrigin(url)}: not an allowed GitHub host`);
    this.name = "DisallowedUrlError";
  }
}

export type DownloadOptions = {
  url: string;
  destPath: string;
  allowedHosts: readonly string[];
  /** Progress estimate until the server reports a length. */
  expectedBytes?: number;
  onProgress?: (bytesReceived: number, bytesTotal: number) => void;
  fetchImpl?: FetchLike;
  progressIntervalMs?: number;
};

export type DownloadResult = { bytes: number; totalBytes: number | null; resumed: boolean };

export async function downloadToFile(opts: DownloadOptions): Promise<DownloadResult> {
  const existing = statSync(opts.destPath, { throwIfNoEntry: false });
  const startByte = existing?.size ?? 0;
  const res = await fetchAllowed(opts, startByte > 0 ? { Range: `bytes=${startByte}-` } : {});

  if (res.status === 416) {
    // The partial reaches (or passes) the end of the resource.
    await res.body?.cancel().catch(() => undefined);
    const total = parseContentRange(res.headers.get("content-range"))?.total ?? null;
    if (total !== null && total === startByte) {
      opts.onProgress?.(startByte, total);
      return { bytes: startByte, totalBytes: total, resumed: true };
    }
    await unlink(opts.destPath).catch(() => undefined);
    return downloadToFile(opts);
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new Error(`download failed: ${res.status} ${res.statusText}`);
  }
  if (!res.body) throw new Error("download failed: empty response body");

  let resumed = false;
  let totalBytes: number | null;
  if (res.status === 206) {
    const range = parseContentRange(res.headers.get("content-range"));
    if (startByte === 0 || !range || range.start !== startByte) {
      await res.body.cancel().catch(() => undefined);
      await unlink(opts.destPath).catch(() => undefined);
      throw new Error("download failed: server sent an unexpected byte range");
    }
    resumed = true;
    totalBytes = range.total;
  } else {
    // 200: the whole resource (a server that ignores Range): start over.
    const length = Number(res.headers.get("content-length"));
    const encoded = (res.headers.get("content-encoding") ?? "identity") !== "identity";
    totalBytes = !encoded && Number.isFinite(length) && length > 0 ? length : null;
  }

  let bytesReceived = resumed ? startByte : 0;
  const progressTotal = () => totalBytes ?? Math.max(opts.expectedBytes ?? 0, bytesReceived);
  const interval = opts.progressIntervalMs ?? 100;
  let lastEmitAt = 0;
  const emit = () => opts.onProgress?.(bytesReceived, progressTotal());
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytesReceived += chunk.byteLength;
      const now = Date.now();
      if (now - lastEmitAt >= interval) {
        lastEmitAt = now;
        emit();
      }
      callback(null, chunk);
    }
  });
  await pipeline(
    Readable.fromWeb(res.body as never),
    meter,
    createWriteStream(opts.destPath, { flags: resumed ? "a" : "w" })
  );
  emit();

  const bytes = statSync(opts.destPath).size;
  if (totalBytes !== null && bytes !== totalBytes) {
    if (bytes > totalBytes) await unlink(opts.destPath).catch(() => undefined);
    throw new Error(`download incomplete: ${bytes} of ${totalBytes} bytes`);
  }
  return { bytes, totalBytes, resumed };
}

/** Fetches `opts.url`, following redirects only within the allow-list. */
async function fetchAllowed(opts: DownloadOptions, headers: Record<string, string>): Promise<Response> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let url = opts.url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!isAllowedDownloadUrl(url, opts.allowedHosts)) throw new DisallowedUrlError(url);
    // identity: byte ranges and Content-Length must refer to the file itself, not a gzip of it.
    const res = await fetchImpl(url, { headers: { ...headers, "Accept-Encoding": "identity" }, redirect: "manual" });
    if (!REDIRECT_STATUSES.has(res.status)) return res;
    const location = res.headers.get("location");
    await res.body?.cancel().catch(() => undefined);
    if (!location) throw new Error(`download failed: redirect without a location (${res.status})`);
    url = new URL(location, url).toString();
  }
  throw new Error("download failed: too many redirects");
}

// "bytes 100-199/1000" → {start: 100, total: 1000}; "bytes */1000" (a 416) → {start: null, total: 1000}.
export function parseContentRange(header: string | null): { start: number | null; total: number | null } | null {
  if (!header) return null;
  const match = /^bytes\s+(?:(\d+)-\d+|\*)\/(\d+|\*)$/i.exec(header.trim());
  if (!match) return null;
  return {
    start: match[1] !== undefined ? Number(match[1]) : null,
    total: match[2] !== "*" ? Number(match[2]) : null
  };
}

function safeOrigin(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "an invalid URL";
  }
}
