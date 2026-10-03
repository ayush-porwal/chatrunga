/**
 * Messages between the service and the import writer worker (import-writer-worker.ts). The
 * selected chapters go over in slices of at most WRITER_SLICE_NODES nodes, so no single message
 * makes the main thread copy a whole import at once.
 */
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type { ImportResult } from "@chaturanga/shared/types/repertoire";
import type { ImportCommitChapter, ImportCommitJob } from "./core";

/** Most tree nodes one message carries. */
export const WRITER_SLICE_NODES = 2000;

/** What the worker gets through `workerData`. */
export type ImportWriterData = {
  /** The database file; the worker opens its own connection to it. */
  dbPath: string;
  job: Omit<ImportCommitJob, "chapters">;
};

/** What the service posts: each chapter, then its node slices, then `commit`. */
export type ImportWriterRequest =
  | { type: "chapter"; chapter: Omit<ImportCommitChapter, "tree" | "positionKeys"> }
  | { type: "nodes"; nodes: MoveNode[]; keys: [string, string][] }
  | { type: "commit" };

/** The worker's one reply: the committed result, or why nothing was written. */
export type ImportWriterReply = { ok: true; result: ImportResult } | { ok: false; error: string };
