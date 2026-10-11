/**
 * Checks that a downloaded file is the dataset it claims to be before it replaces an installed one:
 * not an error / login page, a real zstd stream when the source is `.zst`, and a CSV that starts
 * with the header the row parsers expect. Only the start is decompressed (bounded work); a zstd
 * file's frame and block headers are walked to its end, so a file cut short or damaged further in
 * is caught too (Node's zstd decompressor reports neither).
 */
import { open } from "node:fs/promises";
import type { ExternalDatabaseSource } from "@chaturanga/shared/types/database";
import { expectedHeader, headerMatches, rowKindForSource } from "./puzzle-rows";
import { readFirstLine } from "./puzzle-scan";

/** The download finished but isn't usable data; whatever was installed before stays. */
export class InvalidDatasetError extends Error {
  constructor(source: Pick<ExternalDatabaseSource, "name">, reason: string) {
    super(
      `The downloaded ${source.name} isn't a valid dataset: ${reason}. Your installed copy, if any, is unchanged.`
    );
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
  if (compressed) {
    const damage = await zstdStructureProblem(filePath);
    if (damage) throw new InvalidDatasetError(source, damage);
  }
  let firstLine: string | null;
  try {
    firstLine = await readFirstLine(filePath, compressed);
  } catch (error) {
    throw new InvalidDatasetError(
      source,
      `it couldn't be read (${error instanceof Error ? error.message : String(error)})`
    );
  }
  const kind = rowKindForSource(source.id);
  if (firstLine === null || !headerMatches(kind, firstLine)) {
    throw new InvalidDatasetError(
      source,
      `it doesn't start with the expected columns (${expectedHeader(kind)})`
    );
  }
}

/** zstd's largest block (RFC 8878 §3.1.1.2.3). */
const MAX_BLOCK_SIZE = 128 * 1024;

/** Reads `length` header bytes at `position`: null past the end of the file or on a short read. */
type HeaderReader = {
  size: number;
  read: (position: number, length: number) => Promise<Buffer | null>;
};

/** Where a frame (or its blocks) ends, or what is wrong with it. */
type FrameWalk = { end: number } | { problem: string };

/**
 * Walks every frame of a zstd file by its headers (RFC 8878 §3.1): skippable frames by their
 * length, zstd frames block by block to the last one and its checksum. Reads only headers (a few
 * bytes per 128 KiB block) and decompresses nothing. Returns what is wrong, or null when every
 * frame is whole and the file ends exactly after the last one.
 */
async function zstdStructureProblem(filePath: string): Promise<string | null> {
  const file = await open(filePath, "r");
  try {
    const { size } = await file.stat();
    const header = Buffer.alloc(18);
    const reader: HeaderReader = {
      size,
      read: async (position, length) => {
        if (position + length > size) return null;
        const { bytesRead } = await file.read(header, 0, length, position);
        return bytesRead === length ? header : null;
      }
    };
    let offset = 0;
    while (offset < size) {
      const frame = await walkFrame(reader, offset);
      if ("problem" in frame) return frame.problem;
      offset = frame.end;
    }
    return null;
  } finally {
    await file.close();
  }
}

function cutShort(reader: HeaderReader, offset: number): FrameWalk {
  return {
    problem: `it ends in the middle of the compressed data (byte ${offset} of ${reader.size})`
  };
}

/** An end past the file is a frame cut short. */
function endWithin(reader: HeaderReader, end: number): FrameWalk {
  return end > reader.size ? cutShort(reader, reader.size) : { end };
}

/** The frame at `offset`: a skippable one by its length, a zstd one block by block. */
async function walkFrame(reader: HeaderReader, offset: number): Promise<FrameWalk> {
  const start = await reader.read(offset, 4);
  if (!start) return cutShort(reader, offset);
  const magic = start.readUInt32LE(0);
  if (isSkippableFrameMagic(magic)) {
    const length = await reader.read(offset + 4, 4);
    if (!length) return cutShort(reader, offset);
    return endWithin(reader, offset + 8 + length.readUInt32LE(0));
  }
  if (magic !== ZSTD_FRAME_MAGIC) return { problem: `it has unexpected data at byte ${offset}` };
  return walkZstdFrame(reader, offset);
}

/** A zstd frame: its header (sized by the descriptor's flags), its blocks, then its checksum. */
async function walkZstdFrame(reader: HeaderReader, offset: number): Promise<FrameWalk> {
  const descriptor = await reader.read(offset + 4, 1);
  if (!descriptor) return cutShort(reader, offset);
  const flags = descriptor[0];
  if (flags & 0x08) return { problem: `it has a damaged frame at byte ${offset}` };
  const singleSegment = (flags >> 5) & 1;
  const contentSizeBytes = [singleSegment ? 1 : 0, 2, 4, 8][flags >> 6];
  const dictionaryIdBytes = [0, 1, 2, 4][flags & 3];
  const blocks = await walkBlocks(
    reader,
    offset + 5 + (singleSegment ? 0 : 1) + dictionaryIdBytes + contentSizeBytes
  );
  if ("problem" in blocks) return blocks;
  return endWithin(reader, blocks.end + (flags & 0x04 ? 4 : 0));
}

/** The blocks from `position` to the one flagged last. */
async function walkBlocks(reader: HeaderReader, position: number): Promise<FrameWalk> {
  for (;;) {
    const block = await reader.read(position, 3);
    if (!block) return cutShort(reader, position);
    const value = block.readUIntLE(0, 3);
    const type = (value >> 1) & 3;
    const blockSize = value >>> 3;
    if (type === 3 || blockSize > MAX_BLOCK_SIZE)
      return { problem: `it has a damaged block at byte ${position}` };
    position += 3 + (type === 1 ? 1 : blockSize);
    if (position > reader.size) return cutShort(reader, reader.size);
    if (value & 1) return { end: position };
  }
}
