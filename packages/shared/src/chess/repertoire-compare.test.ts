import { describe, expect, it } from "vitest";
import type { MoveNode } from "../types/chess";
import type { RepertoireColor, RepertoireNodeMeta } from "../types/repertoire";
import { applySan, START_FEN } from "./position";
import { rootPly } from "./pgn";
import {
  collectDecisions,
  defaultImportNodeMeta,
  reconcileDecisions,
  type RepertoireChapterContent
} from "./repertoire-index";
import { compareGameToRepertoire, type ComparedRepertoire } from "./repertoire-compare";
import { positionKey } from "./repertoire-position";

/** Builds a tree from SAN lines; shared prefixes share nodes. Ids are the SAN path (`e4/e5`). */
function treeFromLines(lines: string[][], rootFen: string): MoveNode[] {
  const root: MoveNode = {
    id: "root",
    parentId: null,
    san: null,
    uci: null,
    fenBefore: rootFen,
    fenAfter: rootFen,
    ply: rootPly(rootFen),
    nags: [],
    comment: null,
    arrows: [],
    highlights: [],
    children: []
  };
  const byId = new Map([[root.id, root]]);
  for (const line of lines) {
    let parent = root;
    const path: string[] = [];
    for (const san of line) {
      path.push(san);
      const id = path.join("/");
      let node = byId.get(id);
      if (!node) {
        const applied = applySan(parent.fenAfter, san);
        if (!applied) throw new Error(`illegal ${san} after ${path.join(" ")}`);
        node = {
          id,
          parentId: parent.id,
          san: applied.san,
          uci: applied.uci,
          fenBefore: parent.fenAfter,
          fenAfter: applied.fen,
          ply: parent.ply + 1,
          nags: [],
          comment: null,
          arrows: [],
          highlights: [],
          children: []
        };
        parent.children.push(id);
        byId.set(id, node);
      }
      parent = node;
    }
  }
  return [...byId.values()];
}

type TestChapter = RepertoireChapterContent & { title: string };

/** A chapter with import-default metadata (`patch` adds or overrides entries by node id). */
function chapter(
  color: RepertoireColor,
  id: string,
  lines: string[][],
  options: {
    rootFen?: string;
    kind?: "opening" | "reference";
    sortOrder?: number;
    patch?: Record<string, Partial<RepertoireNodeMeta>>;
  } = {}
): TestChapter {
  const tree = treeFromLines(lines, options.rootFen ?? START_FEN);
  const nodeMeta = defaultImportNodeMeta(color, tree);
  for (const [nodeId, patch] of Object.entries(options.patch ?? {})) {
    nodeMeta[nodeId] = { ...(nodeMeta[nodeId] ?? { edge: "included" }), ...patch };
  }
  return {
    id,
    title: `Chapter ${id}`,
    kind: options.kind ?? "opening",
    enabled: true,
    sortOrder: options.sortOrder ?? 0,
    tree,
    nodeMeta
  };
}

/** A repertoire whose stored decisions are what reindexing these chapters would store. */
function repertoireOf(color: RepertoireColor, chapters: TestChapter[]): ComparedRepertoire {
  const { upserts } = reconcileDecisions([], collectDecisions(color, chapters), {
    repertoireId: "r1"
  });
  return { id: "r1", name: "Mine", revision: 3, chapters, decisions: upserts };
}

/** UCI moves for SAN `moves` from `rootFen`. */
function uciLine(moves: string[], rootFen = START_FEN): string[] {
  let fen = rootFen;
  return moves.map((san) => {
    const applied = applySan(fen, san);
    if (!applied) throw new Error(`illegal ${san}`);
    fen = applied.fen;
    return applied.uci;
  });
}

function fenAfter(moves: string[], rootFen = START_FEN): string {
  let fen = rootFen;
  for (const san of moves) fen = applySan(fen, san)!.fen;
  return fen;
}

function compare(
  color: RepertoireColor,
  chapters: TestChapter[],
  moves: string[],
  rootFen = START_FEN
) {
  return compareGameToRepertoire(
    { color, rootFen, moves: uciLine(moves, rootFen) },
    repertoireOf(color, chapters)
  );
}

describe("compareGameToRepertoire", () => {
  it("reports a game that stays in the repertoire throughout as having no issue", () => {
    const ruy = chapter("white", "a", [["e4", "e5", "Nf3", "Nc6", "Bb5"]]);
    const result = compare("white", [ruy], ["e4", "e5", "Nf3", "Nc6", "Bb5"]);
    expect(result.issue).toBeNull();
    expect(result.matchedPlies).toBe(5);
    expect(result.moves.map((move) => move.status)).toEqual([
      "player-choice",
      "covered-reply",
      "player-choice",
      "covered-reply",
      "player-choice"
    ]);
    expect(result.moves.map((move) => move.san)).toEqual(["e4", "e5", "Nf3", "Nc6", "Bb5"]);
    expect(result.moves[2]).toMatchObject({ ply: 3, chapterId: "a", nodeId: "e4/e5" });
    expect(result).toMatchObject({
      repertoireId: "r1",
      repertoireName: "Mine",
      color: "white",
      revision: 3,
      returnedByTransposition: [],
      chaptersUsed: [{ chapterId: "a", title: "Chapter a" }]
    });
  });

  it("counts an alternative accepted in another chapter as in repertoire", () => {
    const a = chapter("white", "a", [["e4", "e5", "Nf3", "Nc6"]]);
    const b = chapter("white", "b", [["e4", "e5", "Nc3", "Nf6"]], { sortOrder: 1 });
    const result = compare("white", [a, b], ["e4", "e5", "Nc3", "Nf6"]);
    expect(result.issue).toBeNull();
    expect(result.matchedPlies).toBe(4);
    // Chapter a recognized 2.Nc3's position; chapter b supplied the continuation.
    expect(result.moves[2]).toMatchObject({ status: "player-choice", chapterId: "a" });
    expect(result.moves[3]).toMatchObject({ status: "covered-reply", chapterId: "b" });
    expect(result.chaptersUsed.map((item) => item.chapterId)).toEqual(["a", "b"]);
  });

  it("reports a player deviation with the repertoire-wide accepted set", () => {
    const a = chapter("white", "a", [["e4", "e5", "Nf3"]]);
    const b = chapter("white", "b", [["e4", "e5", "Nc3"]], { sortOrder: 1 });
    const result = compare("white", [a, b], ["e4", "e5", "Bc4", "Nf6"]);
    expect(result.matchedPlies).toBe(2);
    expect(result.issue).toEqual({
      status: "player-deviation",
      ply: 3,
      fenBefore: fenAfter(["e4", "e5"]),
      positionKey: positionKey(fenAfter(["e4", "e5"])),
      playedUci: "f1c4",
      playedSan: "Bc4",
      expectedUcis: ["g1f3", "b1c3"],
      expectedSans: ["Nf3", "Nc3"],
      preferredUci: "g1f3",
      chapterId: "a",
      chapterTitle: "Chapter a",
      nodeId: "e4/e5"
    });
    expect(result.moves.map((move) => move.status)).toEqual([
      "player-choice",
      "covered-reply",
      "deviation",
      "outside-scope"
    ]);
  });

  it("reports an uncovered opponent reply with the covered ones", () => {
    const a = chapter("white", "a", [
      ["e4", "e5", "Nf3"],
      ["e4", "c5", "Nf3"]
    ]);
    const result = compare("white", [a], ["e4", "e6", "d4"]);
    expect(result.matchedPlies).toBe(1);
    expect(result.issue).toMatchObject({
      status: "uncovered-opponent",
      ply: 2,
      playedSan: "e6",
      expectedUcis: ["e7e5", "c7c5"],
      expectedSans: ["e5", "c5"],
      preferredUci: null,
      chapterId: "a",
      nodeId: "e4"
    });
    expect(result.moves[1].status).toBe("uncovered");
  });

  it("preparation ends at an authored stop", () => {
    const a = chapter("white", "a", [["e4", "e5", "Nf3", "Nc6", "Bb5"]], {
      patch: { "e4/e5/Nf3": { trainingStop: true } }
    });
    const result = compare("white", [a], ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"]);
    expect(result.matchedPlies).toBe(3);
    expect(result.issue).toMatchObject({
      status: "preparation-ends",
      ply: 4,
      fenBefore: fenAfter(["e4", "e5", "Nf3"]),
      playedSan: "Nc6",
      expectedUcis: [],
      chapterId: "a",
      nodeId: "e4/e5/Nf3"
    });
    // Positions after the stop are context only: the route's continuation isn't transposed-back.
    expect(result.moves.slice(3).map((move) => move.status)).toEqual([
      "after-end",
      "after-end",
      "after-end"
    ]);
    expect(result.returnedByTransposition).toEqual([]);
  });

  it("preparation ends at a leaf, on either side's turn", () => {
    const opponentLeaf = chapter("white", "a", [["e4", "e5", "Nf3"]]);
    expect(compare("white", [opponentLeaf], ["e4", "e5", "Nf3", "Nc6"]).issue).toMatchObject({
      status: "preparation-ends",
      ply: 4,
      playedSan: "Nc6"
    });
    const playerLeaf = chapter("white", "a", [["e4", "e5"]]);
    const result = compare("white", [playerLeaf], ["e4", "e5", "Nf3"]);
    expect(result.issue).toMatchObject({ status: "preparation-ends", ply: 3, playedSan: "Nf3" });
    expect(result.matchedPlies).toBe(2);
    // A game that ends exactly at the leaf has no issue.
    expect(compare("white", [playerLeaf], ["e4", "e5"]).issue).toBeNull();
  });

  it("reports no applicable chapter when nothing matches", () => {
    const qgdRoot = fenAfter(["d4", "d5", "c4"]);
    const qgd = chapter("black", "a", [["e6"]], { rootFen: qgdRoot });
    const result = compare("black", [qgd], ["e4", "e5", "Nf3"]);
    expect(result.matchedPlies).toBe(0);
    expect(result.moves.every((move) => move.status === "outside-scope")).toBe(true);
    expect(result.issue).toEqual({
      status: "no-applicable-chapter",
      ply: 1,
      fenBefore: START_FEN,
      positionKey: positionKey(START_FEN),
      playedUci: "e2e4",
      playedSan: "e4",
      expectedUcis: [],
      expectedSans: [],
      preferredUci: null,
      chapterId: null,
      chapterTitle: null,
      nodeId: null
    });
    expect(result.chaptersUsed).toEqual([]);
  });

  it("a custom-root Black-to-move chapter applies mid-game; earlier moves are outside its scope", () => {
    const root = fenAfter(["e4", "e5", "Nf3"]);
    const custom = chapter(
      "white",
      "a",
      [
        ["Nc6", "Bb5"],
        ["d6", "d4"]
      ],
      { rootFen: root }
    );
    const result = compare("white", [custom], ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"]);
    expect(result.moves.map((move) => move.status)).toEqual([
      "outside-scope",
      "outside-scope",
      "outside-scope",
      "covered-reply",
      "player-choice",
      "after-end"
    ]);
    expect(result.moves[3]).toMatchObject({ ply: 4, chapterId: "a", nodeId: "root" });
    expect(result.matchedPlies).toBe(2);
    expect(result.issue).toMatchObject({ status: "preparation-ends", ply: 6 });
  });

  it("a reference chapter or a reference edge gives no coverage", () => {
    const opening = chapter("white", "a", [["e4", "e5", "Nf3"]]);
    const reference = chapter("white", "r", [["e4", "c5", "Nf3"]], {
      kind: "reference",
      sortOrder: 1
    });
    const result = compare("white", [opening, reference], ["e4", "c5", "Nf3"]);
    expect(result.issue).toMatchObject({ status: "uncovered-opponent", expectedUcis: ["e7e5"] });
    expect(result.chaptersUsed.map((item) => item.chapterId)).toEqual(["a"]);

    const withEdge = chapter(
      "white",
      "a",
      [
        ["e4", "e5", "Nf3"],
        ["e4", "c5", "Nf3"]
      ],
      { patch: { "e4/c5": { edge: "reference" } } }
    );
    expect(compare("white", [withEdge], ["e4", "c5", "Nf3"]).issue).toMatchObject({
      status: "uncovered-opponent",
      expectedUcis: ["e7e5"]
    });
  });

  it("notes a transposition back into known preparation after a deviation", () => {
    const a = chapter("white", "a", [["d4", "Nf6", "c4", "e6", "Nc3", "Bb4"]]);
    const result = compare("white", [a], ["c4", "Nf6", "d4", "e6", "Nc3", "Bb4"]);
    expect(result.issue).toMatchObject({ status: "player-deviation", ply: 1, playedSan: "c4" });
    expect(result.matchedPlies).toBe(0);
    expect(result.moves.map((move) => move.status)).toEqual([
      "deviation",
      "outside-scope",
      "outside-scope",
      "transposed-back",
      "transposed-back",
      "transposed-back"
    ]);
    expect(result.returnedByTransposition).toEqual([
      { ply: 4, chapterId: "a", chapterTitle: "Chapter a", nodeId: "d4/Nf6/c4" }
    ]);
    expect(result.chaptersUsed.map((item) => item.chapterId)).toEqual(["a"]);
  });

  it("notes a return that starts right after the issue", () => {
    const a = chapter("white", "a", [["d4", "d5", "c4"]]);
    const b = chapter("white", "b", [["d5", "d4"]], { rootFen: fenAfter(["Nf3"]), sortOrder: 1 });
    const result = compare("white", [a, b], ["Nf3", "d5", "d4"]);
    expect(result.issue).toMatchObject({ status: "player-deviation", ply: 1, chapterId: "a" });
    expect(result.moves.map((move) => move.status)).toEqual([
      "deviation",
      "transposed-back",
      "transposed-back"
    ]);
    expect(result.returnedByTransposition).toEqual([
      { ply: 2, chapterId: "b", chapterTitle: "Chapter b", nodeId: "root" }
    ]);
    expect(result.chaptersUsed.map((item) => item.chapterId)).toEqual(["a"]);
  });

  it("takes whose move it is from the position, not ply parity", () => {
    const root = fenAfter(["e4"]);
    const sicilian = chapter("black", "a", [["c5", "Nf3", "d6", "d4"]], { rootFen: root });
    const asBlack = compare("black", [sicilian], ["c5", "Nf3", "d6", "d4"], root);
    expect(asBlack.moves.map((move) => [move.ply, move.status])).toEqual([
      [2, "player-choice"],
      [3, "covered-reply"],
      [4, "player-choice"],
      [5, "covered-reply"]
    ]);
    expect(asBlack.issue).toBeNull();
    const deviation = compare("black", [sicilian], ["e5"], root);
    expect(deviation.issue).toMatchObject({
      status: "player-deviation",
      ply: 2,
      expectedSans: ["c5"]
    });
  });

  it("matches castling whether written as king-takes-rook or the king's two-square move", () => {
    const line = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "O-O"];
    const a = chapter("white", "a", [line]);
    const moves = uciLine(line);
    // The chapter stores chessops' king-takes-rook form; the game sends the standard form.
    expect(moves[6]).toBe("e1h1");
    const result = compareGameToRepertoire(
      { color: "white", rootFen: START_FEN, moves: [...moves.slice(0, 6), "e1g1"] },
      repertoireOf("white", [a])
    );
    expect(result.issue).toBeNull();
    expect(result.moves[6]).toMatchObject({ uci: "e1g1", san: "O-O", status: "player-choice" });
  });

  it("stops at the first illegal move", () => {
    const a = chapter("white", "a", [["e4", "e5", "Nf3"]]);
    const result = compareGameToRepertoire(
      { color: "white", rootFen: START_FEN, moves: ["e2e4", "e7e5", "e1e8", "g1f3"] },
      repertoireOf("white", [a])
    );
    expect(result.moves).toHaveLength(2);
    expect(result.issue).toBeNull();
    expect(result.matchedPlies).toBe(2);
  });
});
