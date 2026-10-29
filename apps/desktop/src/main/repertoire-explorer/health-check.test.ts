import { describe, expect, it } from "vitest";
import { fenAfterUci, START_FEN } from "@chaturanga/shared/chess/position";
import type { PuzzleEngineSearch } from "@chaturanga/shared/chess/puzzle-solution";
import { positionKey } from "@chaturanga/shared/chess/repertoire-position";
import type { Maia3Output } from "@chaturanga/shared/engine/maia3";
import type { RepertoireNodeMeta } from "@chaturanga/shared/types/repertoire";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import { nodeAt, treeOf } from "../repertoire/__fixtures__/repertoire-builders";
import { engineFlags, healthPositions, type HealthRepertoire } from "./health-check";

const AFTER_E4 = fenAfterUci(START_FEN, "e2e4")!;
const AFTER_D5 = fenAfterUci(AFTER_E4, "d7d5")!;

function chapter(
  lines: string[][],
  meta: (tree: MoveNode[]) => Record<string, RepertoireNodeMeta> = () => ({})
): HealthRepertoire["chapters"][number] {
  const tree = treeOf(START_FEN, lines);
  return { id: "c1", kind: "opening", enabled: true, sortOrder: 0, tree, nodeMeta: meta(tree) };
}

function white(chapters: HealthRepertoire["chapters"]): HealthRepertoire {
  return { color: "white", chapters, decisions: [] };
}

type Line = { pv: string[]; cp: number };

/** An engine answering from a script keyed by FEN (and the searched move); else no lines. */
function scriptedEngine(script: Record<string, Line[]>) {
  const searches: { fen: string; search: PuzzleEngineSearch }[] = [];
  return {
    searches,
    analyse: (fen: string, search: PuzzleEngineSearch) => {
      searches.push({ fen, search });
      const key = search.searchmoves ? `${fen} ${search.searchmoves.join(",")}` : fen;
      return Promise.resolve(
        (script[key] ?? []).map((line, index) => ({
          multipv: index + 1,
          score: { type: "cp" as const, value: line.cp },
          pv: line.pv
        }))
      );
    }
  };
}

function checkInput(
  repertoire: HealthRepertoire,
  engine: ReturnType<typeof scriptedEngine>,
  policy: Record<string, number> | null = null
) {
  const progress: [number, number][] = [];
  return {
    progress,
    input: {
      positions: healthPositions(repertoire),
      engine,
      maia: policy
        ? {
            evaluate: (queries: readonly { fen: string }[]) =>
              Promise.resolve(queries.map((): Maia3Output => ({ policy, value: 0.5 })))
          }
        : null,
      rating: 1500,
      signal: new AbortController().signal,
      beforeSearch: () => Promise.resolve(),
      onProgress: (done: number, total: number) => progress.push([done, total])
    }
  };
}

describe("health check rules", () => {
  it("flags a covered reply the player has no practised answer to, unless the line ends or stops there", async () => {
    // 1.e4 c5 has only a study-only answer: no practised move after it.
    const studyOnly = (tree: MoveNode[]) => ({
      [nodeAt(tree, ["e2e4", "c7c5", "g1f3"]).id]: { edge: "reference" as const }
    });
    const lines = [
      ["e2e4", "e7e5", "g1f3"],
      ["e2e4", "c7c5", "g1f3"]
    ];
    const { noAnswer } = healthPositions(white([chapter(lines, studyOnly)]));
    expect(noAnswer).toStrictEqual([
      {
        positionKey: positionKey(AFTER_E4),
        fen: AFTER_E4,
        kind: "no-answer",
        uci: "c7c5",
        bestUci: null,
        loss: null,
        probability: null,
        rating: null
      }
    ]);

    // A reply that ends its line (a leaf), or a stop, needs no answer.
    expect(healthPositions(white([chapter([["e2e4", "c7c5"]])])).noAnswer).toStrictEqual([]);
    const stopped = (tree: MoveNode[]) => ({
      ...studyOnly(tree),
      [nodeAt(tree, ["e2e4", "c7c5"]).id]: { edge: "covered" as const, trainingStop: true }
    });
    expect(healthPositions(white([chapter(lines, stopped)])).noAnswer).toStrictEqual([]);

    // An answer elsewhere in the repertoire (another chapter reaching the position) counts.
    const answered = { ...chapter([["e2e4", "c7c5", "b1c3"]]), id: "c2", sortOrder: 1 };
    expect(healthPositions(white([chapter(lines, studyOnly), answered])).noAnswer).toStrictEqual(
      []
    );
  });

  it("flags a practised move that loses 10 win-% or more against the engine's best", async () => {
    // 1.e4 (practised) against 1.d4: within MultiPV 2, 1.e4 drops from +1.00 to −1.00.
    const repertoire = white([chapter([["e2e4", "e7e5", "g1f3"]])]);
    const engine = scriptedEngine({
      [START_FEN]: [
        { pv: ["d2d4"], cp: 100 },
        { pv: ["e2e4"], cp: -100 }
      ],
      // 2.Nf3 isn't among the two lines: it is searched on its own, and loses little.
      [fenAfterUci(AFTER_E4, "e7e5")!]: [
        { pv: ["f1c4"], cp: 40 },
        { pv: ["b1c3"], cp: 35 }
      ],
      [`${fenAfterUci(AFTER_E4, "e7e5")!} g1f3`]: [{ pv: ["g1f3"], cp: 30 }]
    });
    const { input, progress } = checkInput(repertoire, engine);
    const flags = await engineFlags(input);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      kind: "engine-disagrees",
      positionKey: positionKey(START_FEN),
      uci: "e2e4",
      bestUci: "d2d4",
      probability: null
    });
    expect(flags[0].loss).toBeGreaterThanOrEqual(10);
    // Depth 18, MultiPV 2; the move outside the lines on its own.
    expect(engine.searches.map(({ search }) => search)).toStrictEqual([
      { depth: 18, multipv: 2 },
      { depth: 18, multipv: 2 },
      { depth: 18, multipv: 1, searchmoves: ["g1f3"] }
    ]);
    expect(progress.at(-1)).toStrictEqual([2, 2]);
  });

  it("flags an uncovered reply Maia gives 30% or more that loses 20 win-% for the opponent", async () => {
    const repertoire = white([chapter([["e2e4", "e7e5", "g1f3"]])]);
    const engine = scriptedEngine({
      // Black's best at 1.e4 is equal; after 1…d5?, White's 2.exd5 is +3.
      [AFTER_E4]: [
        { pv: ["e7e5"], cp: 0 },
        { pv: ["c7c5"], cp: -10 }
      ],
      [AFTER_D5]: [{ pv: ["e4d5"], cp: 300 }]
    });
    // d5 is likely and loses; e5 is covered; c5 is too unlikely to count.
    const policy = { d7d5: 0.4, e7e5: 0.35, c7c5: 0.25 };
    const { input } = checkInput(repertoire, engine, policy);
    const flags = await engineFlags(input);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      kind: "common-mistake",
      positionKey: positionKey(AFTER_E4),
      uci: "d7d5",
      bestUci: "e4d5",
      probability: 0.4,
      rating: 1500
    });
    expect(flags[0].loss).toBeGreaterThanOrEqual(20);

    // Without Maia 3 there are no common-mistake flags.
    expect(await engineFlags(checkInput(repertoire, engine).input)).toStrictEqual([]);
  });

  it("leaves paused decisions out of the engine check", () => {
    const repertoire: HealthRepertoire = {
      ...white([chapter([["e2e4", "e7e5", "g1f3"]])]),
      decisions: [
        {
          repertoireId: "r",
          positionKey: positionKey(START_FEN),
          acceptedUcis: ["e2e4"],
          preferredUci: "e2e4",
          prompt: null,
          hint: null,
          wrongMoveFeedback: {},
          paused: true
        }
      ]
    };
    expect(healthPositions(repertoire).decisions.map((decision) => decision.fen)).toStrictEqual([
      fenAfterUci(AFTER_E4, "e7e5")
    ]);
  });
});
