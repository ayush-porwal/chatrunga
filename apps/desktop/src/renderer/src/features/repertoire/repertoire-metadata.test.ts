import { describe, expect, it, vi } from "vitest";
import {
  REPERTOIRE_METADATA_LIMITS,
  type RepertoireDetail
} from "@chaturanga/shared/types/repertoire";
import {
  adoptMetadataRevision,
  formatTags,
  metadataChanged,
  metadataErrors,
  metadataForm,
  metadataPatch,
  nameError,
  parseTags,
  saveMetadata
} from "./repertoire-metadata";

const LIMITS = REPERTOIRE_METADATA_LIMITS;
const opened = { name: "Najdorf", description: "Main lines", tags: ["sicilian", "sharp"] };

function stored(patch: Partial<RepertoireDetail> = {}): RepertoireDetail {
  return {
    id: "r1",
    color: "black",
    revision: 4,
    archivedAt: null,
    createdAt: 0,
    updatedAt: 0,
    chapterCount: 1,
    decisionCount: 0,
    dueCount: 0,
    lastStudiedAt: null,
    chapters: [],
    workspace: null,
    ...opened,
    ...patch
  };
}

describe("repertoire metadata form", () => {
  it("reads tags as a comma-separated line: trimmed, blanks dropped, each once", () => {
    expect(parseTags(" sharp, main line,, sharp ,")).toEqual(["sharp", "main line"]);
    expect(parseTags("")).toEqual([]);
    expect(formatTags(["sharp", "main line"])).toBe("sharp, main line");
    expect(metadataForm(opened)).toEqual({
      name: "Najdorf",
      description: "Main lines",
      tags: "sicilian, sharp"
    });
  });

  it("refuses what the main process would cut: a blank or long name, long text, too many tags", () => {
    expect(nameError("  ")).toBe("Enter a name.");
    expect(nameError("n".repeat(LIMITS.name))).toBeNull();
    expect(nameError(` ${"n".repeat(LIMITS.name)} `)).toBeNull();
    expect(nameError("n".repeat(LIMITS.name + 1))).toMatch(/200 characters/);
    const ok = { name: "A", description: "d".repeat(LIMITS.description), tags: "a, b" };
    expect(metadataErrors(ok)).toEqual({});
    expect(metadataErrors({ ...ok, description: "d".repeat(LIMITS.description + 1) })).toEqual({
      description: "Keep the description to 5,000 characters."
    });
    const many = Array.from({ length: LIMITS.tags + 1 }, (_, index) => `t${index}`).join(",");
    expect(metadataErrors({ ...ok, tags: many }).tags).toBe("Use at most 32 tags.");
    // Repeats count once.
    expect(metadataErrors({ ...ok, tags: `${many.split(",").slice(0, 32).join(",")},t0` })).toEqual(
      {}
    );
    expect(metadataErrors({ ...ok, name: "", tags: "x".repeat(LIMITS.tag + 1) })).toEqual({
      name: "Enter a name.",
      tags: `“${"x".repeat(20)}…” is longer than 50 characters.`
    });
  });

  it("patches only the fields the form changed, as the main process stores them", () => {
    expect(metadataPatch(opened, metadataForm(opened))).toEqual({});
    expect(
      metadataPatch(opened, {
        name: " Najdorf ",
        description: "Main lines ",
        tags: "sicilian,sharp"
      })
    ).toEqual({});
    expect(
      metadataPatch(opened, { name: "Najdorf 6.Bg5", description: "", tags: "sharp, sicilian" })
    ).toEqual({ name: "Najdorf 6.Bg5", description: "", tags: ["sharp", "sicilian"] });
  });

  it("sees a conflict only in the metadata, not in other writes to the repertoire", () => {
    expect(metadataChanged(opened, stored({ revision: 9 }))).toBe(false);
    expect(metadataChanged(opened, stored({ name: "Renamed" }))).toBe(true);
    expect(metadataChanged(opened, stored({ description: "" }))).toBe(true);
    expect(metadataChanged(opened, stored({ tags: ["sicilian"] }))).toBe(true);
  });
});

describe("saveMetadata", () => {
  const form = { name: "Najdorf", description: "Main lines", tags: "sicilian, sharp, new" };

  function deps(
    loads: RepertoireDetail[],
    write = vi.fn(async (input: { expectedRevision: number }) =>
      stored({ revision: input.expectedRevision + 1, tags: ["sicilian", "sharp", "new"] })
    )
  ) {
    return {
      id: "r1",
      opened,
      form,
      flushDraft: vi.fn(async () => true),
      load: vi.fn(async () => loads.shift()!),
      write,
      adopt: vi.fn()
    };
  }

  it("saves the draft first, then writes the changes against the stored revision", async () => {
    const input = deps([stored({ revision: 7 })]);
    const outcome = await saveMetadata(input);
    expect(outcome).toMatchObject({ kind: "saved", detail: { revision: 8 } });
    expect(input.flushDraft.mock.invocationCallOrder[0]).toBeLessThan(
      input.load.mock.invocationCallOrder[0]
    );
    expect(input.write).toHaveBeenCalledWith({
      id: "r1",
      expectedRevision: 7,
      patch: { tags: ["sicilian", "sharp", "new"] }
    });
    expect(input.adopt).toHaveBeenCalledWith(7, 8);
  });

  it("writes nothing when the draft can't be saved, the form changes nothing, or it conflicts", async () => {
    const unsaved = deps([stored()]);
    unsaved.flushDraft.mockResolvedValue(false);
    expect(await saveMetadata(unsaved)).toEqual({ kind: "draft-unsaved" });
    expect(unsaved.load).not.toHaveBeenCalled();

    const same = deps([stored()]);
    expect(await saveMetadata({ ...same, form: metadataForm(opened) })).toEqual({
      kind: "unchanged"
    });

    const renamed = stored({ name: "Renamed elsewhere", revision: 5 });
    const conflict = deps([renamed]);
    expect(await saveMetadata(conflict)).toEqual({ kind: "conflict", stored: renamed });
    expect(conflict.write).not.toHaveBeenCalled();
  });

  it("retries once when an unrelated write landed in between, then gives up", async () => {
    const stale = (): Promise<RepertoireDetail> =>
      Promise.reject(
        new Error(
          "Error invoking remote method 'repertoires:updateMetadata': Error: Invalid expectedRevision: repertoire changed (stored 8, expected 7)"
        )
      );
    const write = vi.fn(stale);
    write.mockImplementationOnce(stale);
    write.mockImplementationOnce(async () => stored({ revision: 9 }));
    const retried = deps([stored({ revision: 7 }), stored({ revision: 8 })], write);
    expect(await saveMetadata(retried)).toMatchObject({ kind: "saved" });
    expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: 8 }));
    expect(retried.adopt).toHaveBeenCalledWith(8, 9);

    const always = deps([stored({ revision: 7 }), stored({ revision: 8 })], vi.fn(stale));
    await expect(saveMetadata(always)).rejects.toThrow(/repertoire changed/);
    expect(always.adopt).not.toHaveBeenCalled();

    const broken = deps(
      [stored()],
      vi.fn((): Promise<RepertoireDetail> => Promise.reject(new Error("disk full")))
    );
    await expect(saveMetadata(broken)).rejects.toThrow("disk full");
    expect(broken.load).toHaveBeenCalledTimes(1);
  });
});

describe("adoptMetadataRevision", () => {
  it("moves only this repertoire's draft, and only when it was current", () => {
    const workspace = (repertoireId: string | null, baseRevision: number) => ({
      repertoireId,
      baseRevision,
      adoptRevision: vi.fn()
    });
    const current = workspace("r1", 4);
    adoptMetadataRevision(current, "r1", 4, 5);
    expect(current.adoptRevision).toHaveBeenCalledWith(5);
    const behind = workspace("r1", 3);
    adoptMetadataRevision(behind, "r1", 4, 5);
    expect(behind.adoptRevision).not.toHaveBeenCalled();
    const other = workspace("r2", 4);
    adoptMetadataRevision(other, "r1", 4, 5);
    expect(other.adoptRevision).not.toHaveBeenCalled();
  });
});
