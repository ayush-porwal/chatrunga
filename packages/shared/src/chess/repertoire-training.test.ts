import { describe, expect, it } from "vitest";
import type { RepertoireChapter, RepertoireNodeMeta } from "../types/repertoire";
import { buildChapterLookup, collectDecisions, defaultImportNodeMeta } from "./repertoire-index";
import { parseRepertoirePgn } from "./repertoire-pgn";
import {
  chapterTraining,
  importedDecisionCount,
  ownMoveCause,
  scopeCause,
  trainableChapter,
  trainingPicks
} from "./repertoire-training";

/** 1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 (2. Nc3 as an alternative), ids n1… depth-first. */
const SICILIAN = "1. e4 c5 2. Nf3 (2. Nc3 Nc6) d6 3. d4 cxd4 4. Nxd4 *";

function chapterFrom(
  pgn: string,
  nodeMeta: (ids: Record<string, string>) => Record<string, RepertoireNodeMeta> = () => ({}),
  overrides: Partial<RepertoireChapter> = {}
): { chapter: RepertoireChapter; ids: Record<string, string> } {
  const [game] = parseRepertoirePgn(pgn).games;
  // Ids by SAN path: "e4", "e4 c5", "e4 c5 Nf3", …
  const ids: Record<string, string> = {};
  const byId = new Map(game.tree.map((node) => [node.id, node]));
  for (const node of game.tree) {
    const sans: string[] = [];
    for (let at = node; at.parentId; at = byId.get(at.parentId)!) sans.unshift(at.san!);
    if (sans.length) ids[sans.join(" ")] = node.id;
  }
  return {
    ids,
    chapter: {
      id: "c1",
      title: "Chapter 1",
      sortOrder: 0,
      kind: "opening",
      enabled: true,
      rootFen: game.rootFen,
      revision: 1,
      nodeCount: game.nodeCount,
      dueCount: 0,
      headers: {},
      tree: game.tree,
      nodeMeta: nodeMeta(ids),
      ...overrides
    }
  };
}

/** Every move kept as reference: what moves played while studying, or a whole game, start as. */
function allReference(chapter: RepertoireChapter): Record<string, RepertoireNodeMeta> {
  return Object.fromEntries(
    chapter.tree.filter((node) => node.parentId).map((node) => [node.id, { edge: "reference" }])
  );
}

describe("import defaults", () => {
  it("an imported White chapter trains each of White's moves on its main line", () => {
    const { chapter } = chapterFrom("1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 *");
    const imported = { ...chapter, nodeMeta: defaultImportNodeMeta("white", chapter.tree) };
    const training = chapterTraining("white", imported);
    expect(training.blocker).toBeNull();
    expect(training.decisionKeys).toHaveLength(4);
  });
});

describe("importedDecisionCount", () => {
  it("counts what an import would train for the player's side", () => {
    const { chapter } = chapterFrom(SICILIAN);
    expect(importedDecisionCount("white", chapter.tree)).toBe(4);
    // Black: 1... c5, 2... d6, 3... cxd4 and, after the covered reply 2. Nc3, 2... Nc6.
    expect(importedDecisionCount("black", chapter.tree)).toBe(4);
  });
});

describe("scopeCause", () => {
  it("names the chapter first: left out, then reference material", () => {
    const { chapter } = chapterFrom(SICILIAN);
    const lookup = buildChapterLookup(chapter);
    expect(scopeCause({ ...chapter, enabled: false }, lookup, "n2")).toEqual({ kind: "left-out" });
    expect(scopeCause({ ...chapter, kind: "reference" }, lookup, "n2")).toEqual({
      kind: "reference-chapter"
    });
    expect(scopeCause(chapter, lookup, "n2")).toBeNull();
  });

  it("names the first move on the route that is reference or left out", () => {
    const { chapter, ids } = chapterFrom(SICILIAN, (ids) => ({
      [ids["e4"]]: { edge: "reference" },
      [ids["e4 c5 Nf3"]]: { edge: "included", disabled: true }
    }));
    const lookup = buildChapterLookup(chapter);
    expect(scopeCause(chapter, lookup, ids["e4 c5 Nf3 d6"])).toEqual({
      kind: "reference-move",
      nodeId: ids["e4"]
    });
    const included = {
      ...chapter,
      nodeMeta: { ...chapter.nodeMeta, [ids["e4"]]: { edge: "included" as const } }
    };
    expect(scopeCause(included, lookup, ids["e4 c5 Nf3 d6"])).toEqual({
      kind: "disabled-branch",
      nodeId: ids["e4 c5 Nf3"]
    });
  });

  it("a practice end applies below its move, a practice start to routes through it", () => {
    const { chapter, ids } = chapterFrom(SICILIAN, (ids) => ({
      [ids["e4 c5"]]: { edge: "covered", trainingStop: true },
      [ids["e4 c5 Nc3"]]: { edge: "reference", trainingStart: true }
    }));
    const lookup = buildChapterLookup(chapter);
    expect(scopeCause(chapter, lookup, ids["e4 c5"])).toEqual({
      kind: "before-start",
      nodeId: ids["e4 c5 Nc3"]
    });
    const noStart = { ...chapter, nodeMeta: { [ids["e4 c5"]]: chapter.nodeMeta[ids["e4 c5"]] } };
    expect(scopeCause(noStart, lookup, ids["e4 c5"])).toBeNull();
    expect(scopeCause(noStart, lookup, ids["e4 c5 Nf3"])).toEqual({
      kind: "stopped",
      nodeId: ids["e4 c5"]
    });
  });
});

describe("ownMoveCause", () => {
  it("is null for an accepted move in scope and for an opponent's move", () => {
    const { chapter, ids } = chapterFrom(SICILIAN);
    const lookup = buildChapterLookup(chapter);
    expect(ownMoveCause(chapter, lookup, ids["e4"])).toBeNull();
    expect(ownMoveCause(chapter, lookup, "root")).toBeNull();
  });

  it("an own move that isn't accepted is its own cause", () => {
    const { chapter, ids } = chapterFrom(SICILIAN, (ids) => ({ [ids["e4"]]: { edge: "covered" } }));
    expect(ownMoveCause(chapter, buildChapterLookup(chapter), ids["e4"])).toEqual({
      kind: "reference-move",
      nodeId: ids["e4"]
    });
  });
});

describe("chapterTraining", () => {
  it("a chapter whose moves are all reference names the player's first move", () => {
    const { chapter, ids } = chapterFrom(SICILIAN);
    const reference = { ...chapter, nodeMeta: allReference(chapter) };
    expect(chapterTraining("white", reference)).toEqual({
      decisionKeys: [],
      blocker: { kind: "reference-move", nodeId: ids["e4"] }
    });
  });

  it("names a chapter left out, a reference chapter, an empty one and one without own moves", () => {
    const { chapter } = chapterFrom(SICILIAN);
    expect(chapterTraining("white", { ...chapter, enabled: false }).blocker).toEqual({
      kind: "left-out"
    });
    expect(chapterTraining("white", { ...chapter, kind: "reference" }).blocker).toEqual({
      kind: "reference-chapter"
    });
    const empty = chapterFrom('[Event "Empty"]\n\n*').chapter;
    expect(chapterTraining("white", empty)).toEqual({
      decisionKeys: [],
      blocker: { kind: "no-moves" }
    });
    // 1. e4 alone has no move of Black's.
    const onlyWhite = chapterFrom("1. e4 *").chapter;
    expect(chapterTraining("black", onlyWhite).blocker).toEqual({ kind: "no-own-moves" });
  });

  it("lists the decisions of a chapter that trains", () => {
    const { chapter } = chapterFrom(SICILIAN);
    const training = chapterTraining("white", chapter);
    expect(training.blocker).toBeNull();
    expect(training.decisionKeys).toEqual([...collectDecisions("white", [chapter]).keys()]);
    expect(training.decisionKeys).toHaveLength(4);
  });
});

describe("trainableChapter", () => {
  it("makes an all-reference chapter train like an import, keeping alternatives as reference", () => {
    const { chapter, ids } = chapterFrom(SICILIAN);
    const fixed = trainableChapter("white", { ...chapter, nodeMeta: allReference(chapter) });
    expect(fixed.nodeMeta[ids["e4"]]).toEqual({ edge: "included" });
    expect(fixed.nodeMeta[ids["e4 c5"]]).toEqual({ edge: "covered" });
    expect(fixed.nodeMeta[ids["e4 c5 Nf3"]]).toEqual({ edge: "included" });
    expect(fixed.nodeMeta[ids["e4 c5 Nc3"]]).toEqual({ edge: "reference" });
    // Below a reference alternative nothing changes.
    expect(fixed.nodeMeta[ids["e4 c5 Nc3 Nc6"]]).toEqual({ edge: "reference" });
    expect(collectDecisions("white", [fixed]).size).toBe(4);
  });

  it("switches the chapter on as an opening chapter and keeps training marks and choices", () => {
    const { chapter, ids } = chapterFrom(SICILIAN, (ids) => ({
      [ids["e4 c5 Nc3"]]: { edge: "included", trainingStop: true }
    }));
    const fixed = trainableChapter("white", { ...chapter, kind: "reference", enabled: false });
    expect(fixed.kind).toBe("opening");
    expect(fixed.enabled).toBe(true);
    // Nc3 was accepted already: Nf3 stays as it was (included by default, no entry).
    expect(fixed.nodeMeta[ids["e4 c5 Nc3"]]).toEqual({ edge: "included", trainingStop: true });
    expect(fixed.nodeMeta[ids["e4 c5 Nf3"]]).toBeUndefined();
  });

  it("leaves a chapter that trains as it was", () => {
    const { chapter } = chapterFrom(SICILIAN);
    expect(trainableChapter("white", chapter).nodeMeta).toEqual(chapter.nodeMeta);
  });

  it("accepts the move the repertoire already accepts at a position, not widening its decision", () => {
    const { chapter, ids } = chapterFrom(SICILIAN);
    const reference = { ...chapter, nodeMeta: allReference(chapter) };
    const lookup = buildChapterLookup(chapter);
    const afterC5 = lookup.positionKeys.get(ids["e4 c5"])!;
    // Another chapter practises 2. Nc3 after 1. e4 c5: this one accepts Nc3 there, not Nf3.
    const acceptedAt = (key: string) => (key === afterC5 ? ["b1c3"] : undefined);
    const fixed = trainableChapter("white", reference, acceptedAt);
    expect(fixed.nodeMeta[ids["e4 c5 Nc3"]]).toEqual({ edge: "included" });
    expect(fixed.nodeMeta[ids["e4 c5 Nf3"]]).toEqual({ edge: "reference" });
    const picks = trainingPicks("white", reference, acceptedAt);
    expect(picks.find((pick) => pick.positionKey === afterC5)).toMatchObject({
      childId: ids["e4 c5 Nc3"],
      uci: "b1c3",
      widens: false
    });
    expect(picks.some((pick) => pick.widens)).toBe(false);
  });

  it("says which picks widen a decision that accepts none of the chapter's moves", () => {
    const { chapter, ids } = chapterFrom(SICILIAN);
    const reference = { ...chapter, nodeMeta: allReference(chapter) };
    // Without decisions: the first authored moves, widening nothing.
    const first = trainingPicks("white", reference);
    expect(first.map((pick) => pick.childId)).toContain(ids["e4 c5 Nf3"]);
    expect(first.every((pick) => !pick.widens)).toBe(true);
    // The repertoire plays 2. c3 after 1. e4 c5: accepting Nf3 there adds to that decision.
    const afterC5 = buildChapterLookup(chapter).positionKeys.get(ids["e4 c5"])!;
    const widened = trainingPicks("white", reference, (key) =>
      key === afterC5 ? ["c2c3"] : undefined
    ).filter((pick) => pick.widens);
    expect(widened).toEqual([
      expect.objectContaining({ nodeId: ids["e4 c5"], childId: ids["e4 c5 Nf3"], uci: "g1f3" })
    ]);
  });
});
