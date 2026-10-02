/**
 * Checks that a downloaded file is the dataset it claims to be before it replaces an installed one:
 * not an error / login page, a real zstd stream when the source is `.zst`, and a CSV that starts
 * with the header the row parsers expect. Bounded work: only the file's start is read.
 */
import { open } from "node:fs/promises";
import type { ExternalDatabaseSource } from "@chaturanga/shared/types/database";
import { expectedHeader, headerMatches, rowKindForSource } from "./puzzle-rows";
import { readFirstLine } from "./puzzle-scan";

/** The download finished but isn't usable data; whatever was installed before stays. */
export class InvalidDatasetError extends Error {
  constructor(source: Pick<ExternalDatabaseSource, "name">, reason: string) {
    super(`The downloaded ${source.name} isn't a valid dataset: ${reason}. Your installed copy, if any, is unchanged.`);
    this.name = "InvalidDatasetError";
  }
}

/** A web page (an error, captive-portal or login page) served in place of the file. */
export function isHtmlContentType(value: string | null): boolean {
  return /^\s*(text\/html|application\/xhtml\+xml)\b/i.test(value ?? "");
}

/** zstd frame magic (RFC 8878 §3.1.1), and the range of skippable-frame magics (pzstd starts with one). */
const ZSTD_FRAME_MAGIC = 0xfd2fb528;
const isSkippableFrameMagic = (magic: number) => magic >= 0x184d2a50 && magic <= 0x184d2a5f;

async function readHead(filePath: string, length: number): Promise<Buffer> {
  const file = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await file.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

/** Rejects (with `InvalidDatasetError`) unless `filePath` holds `source`'s dataset. */
export async function validateDataset(
  source: Pick<ExternalDatabaseSource, "id" | "name" | "format">,
  filePath: string
): Promise<void> {
  const compressed = source.format.endsWith(".zst");
  const head = await readHead(filePath, 512);
  if (!head.length) throw new InvalidDatasetError(source, "the file is empty");
  if (/^\uFEFF?\s*</.test(head.toString("utf8"))) {
    throw new InvalidDatasetError(source, "the server sent a web page instead of the data");
  }
  if (compressed) {
    const magic = head.length >= 4 ? head.readUInt32LE(0) : -1;
    if (magic !== ZSTD_FRAME_MAGIC && !isSkippableFrameMagic(magic)) {
      throw new InvalidDatasetError(source, "it isn't zstd-compressed");
    }
  }
  let firstLine: string | null;
  try {
    firstLine = await readFirstLine(filePath, compressed);
  } catch (error) {
    throw new InvalidDatasetError(source, `it couldn't be read (${error instanceof Error ? error.message : String(error)})`);
  }
  const kind = rowKindForSource(source.id);
  if (firstLine === null || !headerMatches(kind, firstLine)) {
    throw new InvalidDatasetError(source, `it doesn't start with the expected columns (${expectedHeader(kind)})`);
  }
}
