import { describe, expect, it } from "vitest";
import { START_FEN } from "@chaturanga/shared/chess/position";
import { parseSettingValue } from "./settings-values";
import {
  parseImportCommitInput,
  parseOpeningOfInput,
  parseSaveChapterInput,
  parseStartPracticeInput
} from "./validate-repertoire";

describe("practice home inputs", () => {
  it("parses a line for openingOf, refusing a bad position or move", () => {
    expect(parseOpeningOfInput({ rootFen: START_FEN, moves: ["e2e4"], extra: 1 })).toStrictEqual({
      rootFen: START_FEN,
      moves: ["e2e4"]
    });
    expect(() => parseOpeningOfInput({ rootFen: "bad", moves: [] })).toThrow("rootFen");
    expect(() => parseOpeningOfInput({ rootFen: START_FEN, moves: ["e4"] })).toThrow(
      "is not a UCI move"
    );
  });

  it("accepts the new practice modes and a set's repertoires", () => {
    expect(
      parseStartPracticeInput({
        repertoireId: "r1",
        mode: "practice-early",
        repertoireIds: ["r1", "r2"]
      })
    ).toStrictEqual({ repertoireId: "r1", mode: "practice-early", repertoireIds: ["r1", "r2"] });
    expect(
      parseStartPracticeInput({ repertoireId: "r1", mode: "weak", positionKeys: ["k"] })
    ).toStrictEqual({ repertoireId: "r1", mode: "weak", positionKeys: ["k"] });
    expect(() => parseStartPracticeInput({ repertoireId: "r1", mode: "cram" })).toThrow(
      "practice mode"
    );
  });

  it("keeps a chapter's opening and an import selection's, rebuilt from known fields", () => {
    const opening = { name: "Caro-Kann Defense", eco: "B10", edited: true, extra: 1 };
    const chapter = {
      id: "c1",
      title: "Main",
      sortOrder: 0,
      kind: "opening",
      enabled: true,
      rootFen: START_FEN,
      tree: [],
      opening
    };
    expect(
      parseSaveChapterInput({ repertoireId: "r1", expectedRevision: 1, chapter }).chapter.opening
    ).toStrictEqual({ name: "Caro-Kann Defense", eco: "B10", edited: true });
    const { opening: _none, ...withoutOpening } = chapter;
    expect(
      parseSaveChapterInput({ repertoireId: "r1", expectedRevision: 1, chapter: withoutOpening })
        .chapter
    ).not.toHaveProperty("opening");
    const commit = parseImportCommitInput({
      jobId: "j1",
      repertoireId: "r1",
      expectedRevision: 1,
      selections: [{ gameIndex: 0, title: "", kind: "opening", include: true, opening: null }]
    });
    expect(commit.selections[0].opening).toBeNull();
    expect(() =>
      parseSaveChapterInput({
        repertoireId: "r1",
        expectedRevision: 1,
        chapter: { ...chapter, opening: { name: 3, eco: null, edited: false } }
      })
    ).toThrow("opening name");
  });

  it("checks the practice settings and the remembered hub tab", () => {
    const settings = { newPerDay: null, showMoveOnNew: false, sounds: true };
    expect(parseSettingValue("repertoirePractice", settings)).toStrictEqual(settings);
    expect(() => parseSettingValue("repertoirePractice", { ...settings, newPerDay: 15 })).toThrow(
      "Invalid value for setting repertoirePractice"
    );
    expect(parseSettingValue("repertoireHubTab", "insights")).toBe("insights");
    expect(() => parseSettingValue("repertoireHubTab", "games")).toThrow(
      "Invalid value for setting repertoireHubTab"
    );
  });
});
