import { describe, expect, it } from "vitest";
import type { ImportProgressEvent } from "@chaturanga/shared/types/repertoire";
import {
  adoptCommittedRevision,
  importExpectedRevision,
  mustFlushDraftBeforeImport,
  MAX_IMPORT_PGN_BYTES,
  pgnSizeError,
  progressCounts,
  progressPercent,
  progressPhaseLabel,
  startPreviewRun,
  stepPreviewRun
} from "./import-progress";

function event(patch: Partial<ImportProgressEvent> = {}): ImportProgressEvent {
  return {
    jobId: "job-1",
    phase: "parsing",
    bytesRead: 0,
    totalBytes: 1000,
    gamesSeen: 0,
    nodesSeen: 0,
    error: null,
    ...patch
  };
}

describe("import preview progress", () => {
  it("starts with the dialog's jobId and no progress, then follows only that job's events", () => {
    const run = startPreviewRun("job-1");
    expect(run).toEqual({ jobId: "job-1", latest: null });
    // Any phase of another job (an earlier preview, another window) is ignored.
    for (const phase of ["reading", "parsing", "cancelled", "failed"] as const) {
      expect(stepPreviewRun(run, event({ jobId: "other", phase }))).toEqual({ kind: "ignore" });
    }
    const reading = event({ phase: "reading" });
    expect(stepPreviewRun(run, reading)).toEqual({
      kind: "update",
      run: { jobId: "job-1", latest: reading }
    });
    const next = event({ bytesRead: 500, gamesSeen: 3, nodesSeen: 120 });
    expect(stepPreviewRun(run, next)).toEqual({ kind: "update", run: { ...run, latest: next } });
    expect(stepPreviewRun(run, event({ phase: "ready" }))).toMatchObject({ kind: "update" });
  });

  it("turns cancelled and failed events into outcomes", () => {
    const run = startPreviewRun("job-1");
    expect(stepPreviewRun(run, event({ phase: "cancelled" }))).toEqual({ kind: "cancelled" });
    expect(
      stepPreviewRun(run, event({ phase: "failed", error: "This PGN has more than 1000 games" }))
    ).toEqual({ kind: "failed", error: "This PGN has more than 1000 games" });
    expect(stepPreviewRun(run, event({ phase: "failed", error: null }))).toEqual({
      kind: "failed",
      error: "That PGN couldn't be read."
    });
  });

  it("describes the phase, the counts and the share read", () => {
    expect(progressPhaseLabel(null)).toBe("Starting…");
    expect(progressPhaseLabel(event({ phase: "validating" }))).toBe("Checking the games…");
    expect(progressCounts(null)).toBe("");
    expect(progressCounts(event({ gamesSeen: 1, nodesSeen: 3400 }))).toBe("1 game · 3,400 moves");
    expect(progressPercent(null)).toBeNull();
    expect(progressPercent(event({ totalBytes: null }))).toBeNull();
    expect(progressPercent(event({ totalBytes: 0 }))).toBeNull();
    expect(progressPercent(event({ bytesRead: 250 }))).toBe(25);
    expect(progressPercent(event({ bytesRead: 5000 }))).toBe(100);
    expect(progressPercent(event({ phase: "validating", bytesRead: 10 }))).toBe(100);
  });
});

describe("pgnSizeError", () => {
  it("is null for text within the limit", () => {
    expect(pgnSizeError("1. e4 e5 *")).toBeNull();
    expect(pgnSizeError("x".repeat(30), 30)).toBeNull();
  });

  it("names the limit for text over it, counting UTF-8 bytes", () => {
    expect(pgnSizeError("x".repeat(MAX_IMPORT_PGN_BYTES + 1))).toBe(
      "This PGN is larger than 20 MiB; split it and import it in parts."
    );
    // 10 characters, 20 bytes.
    expect(pgnSizeError("é".repeat(10), 15)).toMatch(/^This PGN is larger than/);
    expect(pgnSizeError("é".repeat(10), 20)).toBeNull();
  });
});

describe("adoptCommittedRevision", () => {
  it("moves the same repertoire's open draft to the new revision and leaves others alone", () => {
    const adopted: number[] = [];
    const adoptRevision = (revision: number) => adopted.push(revision);
    adoptCommittedRevision({ repertoireId: "r1", adoptRevision }, "r1", 7);
    adoptCommittedRevision({ repertoireId: "r2", adoptRevision }, "r1", 8);
    adoptCommittedRevision({ repertoireId: null, adoptRevision }, "r1", 9);
    expect(adopted).toEqual([7]);
  });
});

describe("import commit into the open repertoire", () => {
  it("flushes the draft first only when it belongs to the repertoire imported into", () => {
    const none = { decisionDrafts: {} };
    expect(mustFlushDraftBeforeImport({ repertoireId: "r1", baseRevision: 3, ...none }, "r1")).toBe(true);
    expect(mustFlushDraftBeforeImport({ repertoireId: "r2", baseRevision: 3, ...none }, "r1")).toBe(false);
    expect(mustFlushDraftBeforeImport({ repertoireId: null, baseRevision: 0, ...none }, "r1")).toBe(false);
  });

  it("also flushes first while a prompt or other decision change of that repertoire is unsaved", () => {
    const decisionDrafts = { "r1|k1|prompt": { repertoireId: "r1" } };
    expect(mustFlushDraftBeforeImport({ repertoireId: "r2", baseRevision: 3, decisionDrafts }, "r1")).toBe(true);
    expect(mustFlushDraftBeforeImport({ repertoireId: null, baseRevision: 0, decisionDrafts }, "r1")).toBe(true);
    expect(mustFlushDraftBeforeImport({ repertoireId: "r2", baseRevision: 3, decisionDrafts }, "r3")).toBe(false);
  });

  it("expects the revision the flushed draft stored, else the cached detail's", () => {
    // The flush saved the draft at revision 5 while the cached detail still says 4.
    expect(importExpectedRevision({ repertoireId: "r1", baseRevision: 5 }, "r1", 4)).toBe(5);
    expect(importExpectedRevision({ repertoireId: "r1", baseRevision: 5 }, "r1", 6)).toBe(6);
    expect(importExpectedRevision({ repertoireId: "r1", baseRevision: 5 }, "r1", undefined)).toBe(5);
    expect(importExpectedRevision({ repertoireId: "r2", baseRevision: 9 }, "r1", 4)).toBe(4);
    expect(
      importExpectedRevision({ repertoireId: null, baseRevision: 0 }, "r1", undefined)
    ).toBeUndefined();
  });
});
