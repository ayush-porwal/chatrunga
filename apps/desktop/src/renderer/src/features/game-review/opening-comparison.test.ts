import { describe, expect, it } from "vitest";
import { START_FEN } from "@chaturanga/shared/chess/position";
import type {
  ComparisonIssue,
  ComparisonMove,
  RepertoireComparison
} from "@chaturanga/shared/types/repertoire";
import { fnv1a64, gameContentHash } from "../../queries/repertoire";
import { addLine, rootNode } from "../repertoire/__fixtures__/repertoire";
import {
  comparisonActions,
  defaultCompareColor,
  describeComparison,
  describeReturns,
  inRepertoireTarget,
  mainlineMoves,
  moveLabel,
  moveNumberOf,
  pickRepertoire,
  suggestedSide,
  tokenStatus,
  tokenTitle
} from "./opening-comparison";

/** Comparison moves of a UCI line from the start, all with `status` unless overridden. */
function movesOf(ucis: string[], statuses: ComparisonMove["status"][] = []): ComparisonMove[] {
  const { tree, ids } = addLine([rootNode()], "root", ucis, "m");
  return ids.map((id, index) => {
    const node = tree.find((item) => item.id === id)!;
    return {
      ply: node.ply,
      san: node.san!,
      uci: node.uci!,
      fenBefore: node.fenBefore,
      fenAfter: node.fenAfter,
      positionKey: `k${index}`,
      status: statuses[index] ?? "player-choice",
      chapterId: "c1",
      nodeId: `n${index}`
    };
  });
}

function comparisonOf(
  moves: ComparisonMove[],
  issue: Partial<ComparisonIssue> | null,
  overrides: Partial<RepertoireComparison> = {}
): RepertoireComparison {
  return {
    repertoireId: "r1",
    repertoireName: "Main",
    color: "white",
    revision: 3,
    moves,
    matchedPlies: moves.length,
    issue: issue
      ? {
          status: "player-deviation",
          ply: 1,
          fenBefore: START_FEN,
          positionKey: "k0",
          playedUci: null,
          playedSan: null,
          expectedUcis: [],
          expectedSans: [],
          preferredUci: null,
          chapterId: "c1",
          chapterTitle: "Italian",
          nodeId: "n0",
          ...issue
        }
      : null,
    returnedByTransposition: [],
    chaptersUsed: [{ chapterId: "c1", title: "Italian" }],
    ...overrides
  };
}

const LINE = ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6"];

describe("mainlineMoves", () => {
  it("follows the first child from the root, skipping variations", () => {
    let { tree } = addLine([rootNode()], "root", ["e2e4", "e7e5", "g1f3"], "m");
    ({ tree } = addLine(tree, "m0", ["c7c5"], "v"));
    expect(mainlineMoves(tree)).toEqual([
      { nodeId: "m0", ply: 1, uci: "e2e4" },
      { nodeId: "m1", ply: 2, uci: "e7e5" },
      { nodeId: "m2", ply: 3, uci: "g1f3" }
    ]);
  });

  it("is empty without moves or a root", () => {
    expect(mainlineMoves([rootNode()])).toEqual([]);
    expect(mainlineMoves([])).toEqual([]);
  });
});

describe("move labels", () => {
  it("reads the number and side from the position", () => {
    expect(moveNumberOf(START_FEN)).toEqual({ number: 1, white: true });
    const blackToMove = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 7";
    expect(moveNumberOf(blackToMove)).toEqual({ number: 7, white: false });
    expect(moveLabel(blackToMove, "e5")).toBe("7… e5");
    expect(moveLabel(START_FEN, "e4")).toBe("1. e4");
  });
});

describe("describeComparison", () => {
  it("reports the move the game stayed in repertoire through", () => {
    const moves = movesOf(LINE.slice(0, 4), [
      "player-choice",
      "covered-reply",
      "player-choice",
      "covered-reply"
    ]);
    expect(describeComparison(comparisonOf(moves, null))).toEqual({
      tone: "accent",
      text: "In repertoire through move 2"
    });
  });

  it("names the played move and the expected ones, preferred first", () => {
    const moves = movesOf(LINE.slice(0, 5));
    const summary = describeComparison(
      comparisonOf(moves, {
        status: "player-deviation",
        ply: 5,
        fenBefore: moves[4].fenBefore,
        playedSan: "Bc4",
        playedUci: "f1c4",
        expectedUcis: ["d2d4", "f1b5"],
        expectedSans: ["d4", "Bb5"],
        preferredUci: "f1b5"
      })
    );
    expect(summary).toEqual({
      tone: "warn",
      text: "Left your repertoire at move 3: you played Bc4, your repertoire has Bb5 (preferred) / d4"
    });
  });

  it("names an uncovered reply and the covered ones", () => {
    const moves = movesOf(LINE.slice(0, 4));
    expect(
      describeComparison(
        comparisonOf(moves, {
          status: "uncovered-opponent",
          ply: 4,
          fenBefore: moves[3].fenBefore,
          playedSan: "Nc6",
          playedUci: "b8c6",
          expectedUcis: ["d7d6", "g8f6"],
          expectedSans: ["d6", "Nf6"]
        })
      ).text
    ).toBe("Uncovered reply at move 2: opponent played Nc6; you cover d6, Nf6");
    expect(
      describeComparison(
        comparisonOf(moves, {
          status: "uncovered-opponent",
          ply: 4,
          fenBefore: moves[3].fenBefore,
          playedSan: "Nc6"
        })
      ).text
    ).toBe("Uncovered reply at move 2: opponent played Nc6; no reply is covered here yet");
  });

  it("says after which move preparation ends", () => {
    const moves = movesOf(LINE, ["player-choice", "covered-reply", "player-choice", "after-end"]);
    expect(
      describeComparison(
        comparisonOf(moves, { status: "preparation-ends", ply: 4, fenBefore: moves[3].fenBefore })
      )
    ).toEqual({ tone: "info", text: "Preparation ends after move 2" });
    expect(
      describeComparison(
        comparisonOf(moves, { status: "preparation-ends", ply: 1, fenBefore: START_FEN })
      ).text
    ).toBe("Preparation ends before the first move");
  });

  it("says when the game ends where a chapter begins", () => {
    const moves = movesOf(LINE.slice(0, 3), ["outside-scope", "outside-scope", "outside-scope"]);
    expect(
      describeComparison(
        comparisonOf(moves, null, {
          matchedPlies: 0,
          chaptersUsed: [{ chapterId: "c2", title: "Two knights" }]
        })
      )
    ).toEqual({ tone: "info", text: "This game ends where Two knights begins" });
    expect(describeComparison(comparisonOf(moves, null, { chaptersUsed: [] })).text).toBe(
      "No chapter of this repertoire applies to this game"
    );
  });

  it("says when no chapter applies", () => {
    const moves = movesOf(LINE.slice(0, 2), ["outside-scope", "outside-scope"]);
    expect(describeComparison(comparisonOf(moves, { status: "no-applicable-chapter" })).text).toBe(
      "No chapter of this repertoire applies to this game"
    );
  });

  it("lists returns by transposition with their chapter", () => {
    const moves = movesOf(LINE);
    expect(
      describeReturns(
        comparisonOf(moves, null, {
          returnedByTransposition: [
            { ply: 5, chapterId: "c2", chapterTitle: "Two knights", nodeId: "x" }
          ]
        })
      )
    ).toEqual(["Back in known preparation at move 3 (Two knights)"]);
  });
});

describe("move tokens", () => {
  it("give every status a text label, not only a colour", () => {
    for (const status of [
      "outside-scope",
      "player-choice",
      "covered-reply",
      "deviation",
      "uncovered",
      "after-end",
      "transposed-back"
    ] as const) {
      expect(tokenStatus(status).label.length).toBeGreaterThan(0);
    }
    expect(tokenStatus("deviation")).toEqual({ tone: "warn", label: "Left your repertoire" });
    // Also used for moves after a deviation, so it never claims the repertoire applies later.
    expect(tokenStatus("outside-scope")).toEqual({ tone: "subtle", label: "Outside your repertoire" });
    expect(tokenStatus("uncovered").tone).toBe("danger");
  });

  it("titles a token with its move label and status", () => {
    const [move] = movesOf(["e2e4"], ["player-choice"]);
    expect(tokenTitle(move)).toBe("1. e4: Your repertoire move");
  });
});

describe("colour and repertoire defaults", () => {
  const list = [
    { id: "w1", color: "white" as const },
    { id: "w2", color: "white" as const },
    { id: "b1", color: "black" as const }
  ];

  it("starts on the provenance suggestion", () => {
    expect(defaultCompareColor({ white: null, black: null }, list, "black")).toBe("black");
    expect(defaultCompareColor({ white: "w1", black: "b1" }, list, "black")).toBe("black");
    // The suggestion wins over the one remembered colour.
    expect(defaultCompareColor({ white: "w2", black: "gone" }, list, "black")).toBe("black");
  });

  it("otherwise the one colour whose remembered repertoire still exists, else White", () => {
    expect(defaultCompareColor({ white: null, black: "b1" }, list, null)).toBe("black");
    expect(defaultCompareColor({ white: "w2", black: "gone" }, list, null)).toBe("white");
    expect(defaultCompareColor({ white: null, black: null }, list, null)).toBe("white");
    // A remembered id listed under the other colour doesn't count.
    expect(defaultCompareColor({ white: "b1", black: null }, list, null)).toBe("white");
  });

  it("picks the remembered repertoire of the colour, else the first", () => {
    expect(pickRepertoire(list, "white", "w2")?.id).toBe("w2");
    expect(pickRepertoire(list, "white", "b1")?.id).toBe("w1");
    expect(pickRepertoire(list, "black", null)?.id).toBe("b1");
    expect(pickRepertoire([], "black", "b1")).toBeNull();
  });

  it("suggests the side from a Lichess account or an engine game", () => {
    const headers = { white: "Alice", black: "bob" };
    expect(
      suggestedSide({ source: "lichess", headers, lichessUsername: "Bob", engineSide: null })
    ).toEqual({ color: "black", hint: "You played Black in this Lichess game" });
    expect(
      suggestedSide({ source: "lichess", headers, lichessUsername: null, engineSide: null })
    ).toBeNull();
    expect(
      suggestedSide({ source: "pgn-import", headers, lichessUsername: "bob", engineSide: null })
    ).toBeNull();
    expect(
      suggestedSide({ source: "engine-game", headers, lichessUsername: null, engineSide: "white" })
    ).toEqual({ color: "black", hint: "You played Black against the engine" });
  });
});

describe("comparisonActions", () => {
  const moves = movesOf(LINE);

  it("offers refresh, adopting the played move (as reference) and study on a deviation", () => {
    const actions = comparisonActions(
      comparisonOf(moves, {
        status: "player-deviation",
        positionKey: "k4",
        playedUci: "f1c4",
        nodeId: "n4"
      }).issue
    );
    expect(actions.map((action) => action.kind)).toEqual(["refresh", "stage", "study"]);
    expect(actions[0]).toMatchObject({ label: "Refresh this decision", positionKey: "k4" });
    expect(actions[1]).toMatchObject({
      label: "Adopt played alternative",
      uci: "f1c4",
      edge: "reference",
      nodeId: "n4"
    });
  });

  it("stages an uncovered reply as covered", () => {
    const actions = comparisonActions(
      comparisonOf(moves, { status: "uncovered-opponent", playedUci: "b8c6", nodeId: "n3" }).issue
    );
    expect(actions[0]).toMatchObject({
      kind: "stage",
      label: "Add this response",
      edge: "covered"
    });
  });

  it("studies the end of preparation, or offers another repertoire / the hub", () => {
    expect(
      comparisonActions(comparisonOf(moves, { status: "preparation-ends", nodeId: "n3" }).issue)
    ).toEqual([
      { kind: "study", label: "Study the resulting position", chapterId: "c1", nodeId: "n3" }
    ]);
    expect(
      comparisonActions(
        comparisonOf(moves, { status: "no-applicable-chapter", chapterId: null, nodeId: null })
          .issue
      ).map((action) => action.kind)
    ).toEqual(["choose-repertoire", "hub"]);
    expect(comparisonActions(null)).toEqual([]);
  });

  it("opens the last recognized chapter position when the game stayed in repertoire", () => {
    const stayed = movesOf(LINE.slice(0, 3), ["player-choice", "covered-reply", "outside-scope"]);
    expect(inRepertoireTarget(comparisonOf(stayed, null))).toEqual({
      chapterId: "c1",
      nodeId: "n1"
    });
    expect(inRepertoireTarget(comparisonOf(stayed, { status: "player-deviation" }))).toBeNull();
  });
});

describe("gameContentHash", () => {
  it("depends on the root and the moves only", () => {
    const a = gameContentHash(START_FEN, ["e2e4", "e7e5"]);
    expect(gameContentHash(START_FEN, ["e2e4", "e7e5"])).toBe(a);
    expect(gameContentHash(START_FEN, ["e2e4", "e7e6"])).not.toBe(a);
    expect(gameContentHash(START_FEN, ["e2e4"])).not.toBe(a);
  });

  it("uses 64-bit FNV-1a (reference values)", () => {
    expect(fnv1a64("")).toBe("cbf29ce484222325");
    expect(fnv1a64("a")).toBe("af63dc4c8601ec8c");
    expect(fnv1a64("foobar")).toBe("85944171f73967e8");
    expect(gameContentHash(START_FEN, ["e2e4"])).toMatch(/^[0-9a-f]{16}-1$/);
  });
});
