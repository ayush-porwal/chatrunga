import { makeSquare } from "chessops/util";
import { describe, expect, it } from "vitest";
import type { Maia3Output, Maia3Query } from "../engine/maia3";
import type { AnalysisLine, EngineScore, GameReview, MoveReview } from "../types/engine";
import { GAME_PUZZLE_KINDS } from "../types/game-puzzles";
import { winPercent } from "./move-assessment";
import { parseOpeningBook, positionKey as epd } from "./opening-book";
import { applySan, fenAfterUci, positionFromFen, START_FEN } from "./position";
import {
  GAME_PUZZLE_GENERATOR_VERSION,
  generateGamePuzzles,
  scanFromReview,
  userSideOfGame,
  type GeneratePuzzlesInput,
  type PuzzleEngine
} from "./puzzle-generator";
import type { PuzzleEngineLine, PuzzleEngineSearch } from "./puzzle-solution";
import { positionKey } from "./repertoire-position";
import { invertScore } from "./review";

const SCAN = 12;
const VERIFY = 20;

const cp = (value: number): EngineScore => ({ type: "cp", value });
const mate = (value: number): EngineScore => ({ type: "mate", value });

type Game = { rootFen: string; fens: string[]; moves: string[] };

/** A game from SAN moves: its positions (the end one too) and UCI moves. */
function game(sans: readonly string[], rootFen = START_FEN): Game {
  const fens = [rootFen];
  const moves: string[] = [];
  for (const san of sans) {
    const played = applySan(fens[fens.length - 1] ?? rootFen, san);
    if (!played) throw new Error(`Illegal test move ${san}`);
    fens.push(played.fen);
    moves.push(played.uci);
  }
  return { rootFen, fens, moves };
}

function after(fen: string, ...moves: string[]): string {
  return moves.reduce((current, uci) => {
    const next = fenAfterUci(current, uci);
    if (!next) throw new Error(`Illegal test move ${uci}`);
    return next;
  }, fen);
}

function legalUcis(fen: string): string[] {
  const moves: string[] = [];
  for (const [from, dests] of positionFromFen(fen).allDests())
    for (const to of dests) moves.push(`${makeSquare(from)}${makeSquare(to)}`);
  return moves;
}

type ScriptLine = [uci: string, score: EngineScore];

/**
 * A scripted engine: lines per position (by EPD), depth and `searchmoves` (one move, or "rest" for
 * a search of several). Anything unscripted is a level position: its first legal moves at 0.00, so
 * no move there is clear-cut.
 */
class FakeEngine implements PuzzleEngine {
  readonly searches: { fen: string; search: PuzzleEngineSearch }[] = [];
  private readonly scripts = new Map<string, PuzzleEngineLine[]>();

  script(fen: string, depth: number, lines: readonly ScriptLine[], searchmoves = ""): this {
    this.scripts.set(
      `${depth}|${epd(fen)}|${searchmoves}`,
      lines.map(([uci, score], index) => ({ multipv: index + 1, score, pv: [uci] }))
    );
    return this;
  }

  analyse(fen: string, search: PuzzleEngineSearch): Promise<PuzzleEngineLine[]> {
    this.searches.push({ fen, search });
    const moves = search.searchmoves;
    const restricted = moves === undefined ? "" : moves.length === 1 ? moves.join("") : "rest";
    const lines =
      this.scripts.get(`${search.depth}|${epd(fen)}|${restricted}`) ??
      (moves ?? legalUcis(fen))
        .slice(0, 2)
        .map((uci, index) => ({ multipv: index + 1, score: cp(0), pv: [uci] }));
    return Promise.resolve(lines.slice(0, search.multipv));
  }
}

/**
 * Scripts the quick scan: White's score at each position (centipawns, 0 when missing) and the best
 * move (by index; otherwise a legal move other than the one played).
 */
function scriptScan(
  engine: FakeEngine,
  { fens, moves }: Game,
  white: readonly number[],
  best: Readonly<Partial<Record<number, string>>> = {}
): FakeEngine {
  fens.forEach((fen, index) => {
    const score = cp(white[index] ?? 0);
    const turn = positionFromFen(fen).turn;
    const bestMove = best[index] ?? legalUcis(fen).find((uci) => uci !== moves[index]) ?? "";
    engine.script(fen, SCAN, [[bestMove, turn === "white" ? score : invertScore(score)]]);
  });
  return engine;
}

type Policy = (rating: number) => Record<string, number>;

/** Maia 3 answering from a policy per position (by EPD) and rating; nothing elsewhere. */
class FakeMaia {
  readonly queries: Maia3Query[] = [];
  private readonly policies: Map<string | null, Policy>;

  constructor(policies: readonly [fen: string, policy: Policy][] = []) {
    this.policies = new Map(policies.map(([fen, policy]) => [epd(fen), policy]));
  }

  evaluate(queries: readonly Maia3Query[]): Promise<Maia3Output[]> {
    this.queries.push(...queries);
    return Promise.resolve(
      queries.map((query) => ({
        policy: this.policies.get(epd(query.fen))?.(query.eloSelf) ?? {},
        value: 0.5
      }))
    );
  }
}

function maiaAt(fen: string, policy: Policy): FakeMaia {
  return new FakeMaia([[fen, policy]]);
}

function input(
  { rootFen, moves }: Game,
  engine: FakeEngine,
  overrides: Partial<GeneratePuzzlesInput> = {}
): GeneratePuzzlesInput {
  return {
    rootFen,
    moves,
    userSide: "white",
    ratings: { white: 1500, black: 1500 },
    kinds: GAME_PUZZLE_KINDS,
    depths: { scan: SCAN, verify: VERIFY },
    engine,
    ...overrides
  };
}

/** 4.Bc4 (index 4) drops White from 0.00 to −3.00; the deep check prefers 4.d4, far ahead. */
const OPEN = game(["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3", "Nf6"]);
const OPEN_EVALS = [0, 0, 0, 0, 0, -300, -300, -300, -300];

function openMistake(
  deep: readonly ScriptLine[] = [
    ["d2d4", cp(300)],
    ["b1c3", cp(-300)]
  ]
) {
  return scriptScan(new FakeEngine(), OPEN, OPEN_EVALS, { 4: "d2d4" }).script(
    OPEN.fens[4],
    VERIFY,
    deep
  );
}

/**
 * 3…d6 (index 3) hands White +4.00 (Bb5+ wins); 4.Bc4 lets most of it go (+3.00, not a mistake).
 * The solution goes on with 5.Ba4 after 4…c6 unless `second` says otherwise.
 */
const MISS_SANS = ["e4", "e5", "Nf3", "d6", "Bc4", "h6"];
const MISS = game(MISS_SANS);

function scriptMissedChance(
  g: Game,
  options: { white?: readonly number[]; second?: readonly ScriptLine[] } = {}
): FakeEngine {
  const {
    white = [0, 0, 0, 0, 400, 300, 300],
    second = [
      ["b5a4", cp(600)],
      ["b5c4", cp(0)]
    ]
  } = options;
  const fen = g.fens[4];
  return scriptScan(new FakeEngine(), g, white, { 4: "f1b5" })
    .script(fen, VERIFY, [
      ["f1b5", cp(600)],
      ["d2d4", cp(0)]
    ])
    .script(after(fen, "f1b5"), VERIFY, [["c7c6", cp(-600)]])
    .script(after(fen, "f1b5", "c7c6"), VERIFY, second);
}

describe("generateGamePuzzles: Your mistake and Opponent's chance", () => {
  it("makes a mistake the puzzle of the move that should have been played", async () => {
    const puzzles = await generateGamePuzzles(input(OPEN, openMistake()));
    expect(puzzles).toStrictEqual([
      {
        ply: 5,
        kind: "mistake",
        tags: [],
        solverSide: "white",
        startFen: OPEN.fens[3],
        setupMove: "b8c6",
        solution: ["d2d4"],
        playedMove: "f1c4",
        winBefore: 50,
        winAfter: Math.round((100 - winPercent(300)) * 10) / 10,
        difficulty: null,
        difficultyCapped: false,
        userChance: null,
        chanceRating: null,
        themes: [],
        positionKey: positionKey(OPEN.fens[4]),
        generatorVersion: GAME_PUZZLE_GENERATOR_VERSION,
        depths: { scan: SCAN, verify: VERIFY }
      }
    ]);
  });

  it.each<[string, ScriptLine[]]>([
    [
      "the played move was the best after all",
      [
        ["f1c4", cp(300)],
        ["d2d4", cp(-300)]
      ]
    ],
    [
      "the best move isn't clear-cut",
      [
        ["d2d4", cp(100)],
        ["b1c3", cp(0)]
      ]
    ]
  ])("drops a mistake when %s at the verify depth", async (_reason, deep) => {
    await expect(generateGamePuzzles(input(OPEN, openMistake(deep)))).resolves.toStrictEqual([]);
  });

  it("solves the opponent's mistake as the opponent", async () => {
    const puzzles = await generateGamePuzzles(input(OPEN, openMistake(), { userSide: "black" }));
    expect(puzzles).toMatchObject([
      { kind: "opponent-chance", solverSide: "white", ply: 5, solution: ["d2d4"] }
    ]);
  });

  it("leaves out kinds that weren't asked for", async () => {
    const puzzles = await generateGamePuzzles(
      input(OPEN, openMistake(), { kinds: ["missed-chance", "opponent-chance"] })
    );
    expect(puzzles).toStrictEqual([]);
  });
});

describe("generateGamePuzzles: Missed chance", () => {
  it("makes a missed chance a puzzle of at least two winning moves", async () => {
    const puzzles = await generateGamePuzzles(input(MISS, scriptMissedChance(MISS)));
    expect(puzzles).toMatchObject([
      { kind: "missed-chance", tags: [], ply: 5, solution: ["f1b5", "c7c6", "b5a4"] }
    ]);
  });

  it.each<[string, ScriptLine[]]>([
    [
      "the second move isn't clear-cut",
      [
        ["b5a4", cp(600)],
        ["b5c4", cp(500)]
      ]
    ],
    [
      "the solver no longer stands at +2 after it",
      [
        ["b5a4", cp(100)],
        ["b5c4", cp(-500)]
      ]
    ]
  ])("drops a one-move missed chance (%s)", async (_reason, second) => {
    const engine = scriptMissedChance(MISS, { second });
    await expect(generateGamePuzzles(input(MISS, engine))).resolves.toStrictEqual([]);
  });

  it("isn't a missed chance when the user was already up material", async () => {
    const knightUp = game(MISS_SANS, "r1bqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    const puzzles = await generateGamePuzzles(input(knightUp, scriptMissedChance(knightUp)));
    expect(puzzles).toStrictEqual([]);
  });

  it("makes one puzzle per position: a mistake that also missed a chance is tagged so", async () => {
    const engine = scriptMissedChance(MISS, { white: [0, 0, 0, 0, 400, 0, 0] });
    const puzzles = await generateGamePuzzles(input(MISS, engine));
    expect(puzzles).toMatchObject([
      { kind: "mistake", tags: ["missed-chance"], solution: ["f1b5", "c7c6", "b5a4"] }
    ]);
  });
});

describe("generateGamePuzzles: Maia's kinds and difficulty", () => {
  /** 4.Bc4 was the engine's choice, far ahead of 4.d4. */
  function openFind(): FakeEngine {
    return scriptScan(new FakeEngine(), OPEN, [], { 4: "f1c4" }).script(OPEN.fens[4], VERIFY, [
      ["f1c4", cp(300)],
      ["d2d4", cp(-300)]
    ]);
  }

  it("makes a Hard find of a best move Maia rarely plays at the user's level", async () => {
    const maia = maiaAt(OPEN.fens[4], () => ({ d2d4: 0.9, f1c4: 0.05, b1c3: 0.05 }));
    const puzzles = await generateGamePuzzles(input(OPEN, openFind(), { maia }));
    expect(puzzles).toMatchObject([
      {
        kind: "hard-find",
        tags: [],
        solution: ["f1c4"],
        difficulty: null,
        difficultyCapped: true,
        userChance: 0.05,
        chanceRating: 1500
      }
    ]);
  });

  it("reads Maia at each side's rating, snapped to its grid", async () => {
    const maia = new FakeMaia();
    await generateGamePuzzles(
      input(OPEN, openFind(), { maia, ratings: { white: 1449, black: 2010 } })
    );
    expect(maia.queries[0]).toStrictEqual({ fen: OPEN.fens[0], eloSelf: 1400, eloOppo: 2000 });
  });

  it("drops a Hard find Maia finds often enough, or that the deep check doesn't back", async () => {
    const common = maiaAt(OPEN.fens[4], () => ({ d2d4: 0.75, f1c4: 0.2, b1c3: 0.05 }));
    await expect(
      generateGamePuzzles(input(OPEN, openFind(), { maia: common }))
    ).resolves.toStrictEqual([]);
    const rare = maiaAt(OPEN.fens[4], () => ({ d2d4: 0.9, f1c4: 0.05, b1c3: 0.05 }));
    const engine = openFind().script(OPEN.fens[4], VERIFY, [
      ["d2d4", cp(300)],
      ["f1c4", cp(-300)]
    ]);
    await expect(generateGamePuzzles(input(OPEN, engine, { maia: rare }))).resolves.toStrictEqual(
      []
    );
  });

  it("makes a Tricky position where Maia's likely moves mostly lose, tagging a Hard find", async () => {
    // Maia's top moves until 80%: d4 (loses 3.00) and Nc3 (holds); Bc4 (played) is a rare find.
    const maia = maiaAt(OPEN.fens[4], () => ({ d2d4: 0.5, b1c3: 0.3, h2h3: 0.15, f1c4: 0.05 }));
    const engine = openFind().script(OPEN.fens[4], SCAN, [["d2d4", cp(-300)]], "d2d4");
    const puzzles = await generateGamePuzzles(input(OPEN, engine, { maia }));
    expect(puzzles).toMatchObject([{ kind: "tricky", tags: ["hard-find"], solution: ["f1c4"] }]);
  });

  it("only weighs Maia's moves that cover 80% of its weight", async () => {
    // d4 (loses) and Nc3 (holds) cover 80%; the losing h3 beyond them would tip it.
    const maia = maiaAt(OPEN.fens[4], () => ({ d2d4: 0.4, b1c3: 0.4, h2h3: 0.2 }));
    const engine = openFind()
      .script(OPEN.fens[4], SCAN, [["d2d4", cp(-300)]], "d2d4")
      .script(OPEN.fens[4], SCAN, [["h2h3", cp(-300)]], "h2h3");
    const puzzles = await generateGamePuzzles(input(OPEN, engine, { maia, kinds: ["tricky"] }));
    expect(puzzles).toStrictEqual([]);
  });

  it("tags a mistake made in a Tricky position", async () => {
    const maia = maiaAt(OPEN.fens[4], () => ({ f1c4: 0.6, d2d4: 0.4 }));
    const puzzles = await generateGamePuzzles(input(OPEN, openMistake(), { maia }));
    expect(puzzles).toMatchObject([{ kind: "mistake", tags: ["tricky"] }]);
  });

  it("rates a puzzle at the lowest rating that finds the whole solution half the time", async () => {
    // 4.d4 is found with probability (r − 600) / 2000: 50% at 1600, 45% at the user's 1500.
    const maia = maiaAt(OPEN.fens[4], (rating) => ({ d2d4: (rating - 600) / 2000 }));
    const puzzle = (await generateGamePuzzles(input(OPEN, openMistake(), { maia }))).at(0);
    expect(puzzle).toMatchObject({ difficulty: 1600, difficultyCapped: false, chanceRating: 1500 });
    expect(puzzle?.userChance).toBeCloseTo(0.45);
  });

  it("multiplies the solver's moves' chances", async () => {
    // Each move is found with probability r / 2600: both at 1900 (53%), not at 1800 (48%).
    const maia = new FakeMaia([
      [MISS.fens[4], (rating) => ({ f1b5: rating / 2600 })],
      [after(MISS.fens[4], "f1b5", "c7c6"), (rating) => ({ b5a4: rating / 2600 })]
    ]);
    const [puzzle] = await generateGamePuzzles(input(MISS, scriptMissedChance(MISS), { maia }));
    expect(puzzle).toMatchObject({ kind: "missed-chance", difficulty: 1900 });
  });
});

describe("generateGamePuzzles: clear-cut mates", () => {
  // Ra8# and Rb8# both mate; 1.Kf1 played instead.
  const BACK_RANK = game(["Kf1", "h6"], "7k/6pp/8/8/8/8/8/RR4K1 w - - 0 1");

  function backRank(deep: readonly ScriptLine[], rest?: EngineScore): FakeEngine {
    const fen = BACK_RANK.fens[0];
    const engine = new FakeEngine()
      .script(fen, SCAN, [["a1a8", mate(1)]])
      .script(BACK_RANK.fens[1], SCAN, [["h7h6", cp(0)]])
      .script(fen, VERIFY, deep);
    return rest ? engine.script(fen, VERIFY, [["a1a7", rest]], "rest") : engine;
  }

  it("takes a mate when no second move mates", async () => {
    const engine = backRank([
      ["a1a8", mate(1)],
      ["a1a7", cp(300)]
    ]);
    const puzzles = await generateGamePuzzles(input(BACK_RANK, engine));
    expect(puzzles).toMatchObject([
      { kind: "mistake", solution: ["a1a8"], themes: ["mate", "mateIn1"] }
    ]);
  });

  it("takes a mate in one with another mate in one when every other move is clearly worse", async () => {
    const engine = backRank(
      [
        ["a1a8", mate(1)],
        ["b1b8", mate(1)]
      ],
      cp(300)
    );
    const puzzles = await generateGamePuzzles(input(BACK_RANK, engine));
    expect(puzzles).toMatchObject([{ solution: ["a1a8"] }]);
  });

  it("drops a mate with another mate when a move that doesn't mate still wins big", async () => {
    const engine = backRank(
      [
        ["a1a8", mate(1)],
        ["b1b8", mate(1)]
      ],
      cp(900)
    );
    await expect(generateGamePuzzles(input(BACK_RANK, engine))).resolves.toStrictEqual([]);
  });

  it("drops a mating line that can't be followed to the mate", async () => {
    const engine = backRank([
      ["a1a7", mate(2)],
      ["b1b2", cp(0)]
    ]);
    await expect(generateGamePuzzles(input(BACK_RANK, engine))).resolves.toStrictEqual([]);
  });
});

describe("generateGamePuzzles: solution length", () => {
  it("stops a solution after 8 of the solver's moves", async () => {
    // The rook shuffles a1–a2 against Kh8–g8 for ever, each move clear-cut.
    const shuffle = game(["Kf1"], "7k/8/8/8/8/8/8/R5K1 w - - 0 1");
    const start = shuffle.fens[0];
    const engine = new FakeEngine()
      .script(start, SCAN, [["a1a2", cp(500)]])
      .script(shuffle.fens[1], SCAN, [["h8g8", cp(0)]])
      .script(start, VERIFY, [
        ["a1a2", cp(500)],
        ["a1b1", cp(-500)]
      ])
      .script(after(start, "a1a2"), VERIFY, [["h8g8", cp(-500)]])
      .script(after(start, "a1a2", "h8g8"), VERIFY, [
        ["a2a1", cp(500)],
        ["a2b2", cp(-500)]
      ])
      .script(after(start, "a1a2", "h8g8", "a2a1"), VERIFY, [["g8h8", cp(-500)]]);
    const puzzle = (await generateGamePuzzles(input(shuffle, engine))).at(0);
    expect(puzzle?.solution).toHaveLength(15);
    expect(puzzle?.solution.slice(0, 4)).toStrictEqual(["a1a2", "h8g8", "a2a1", "g8h8"]);
  });

  // After 1.Rd7 Rb1+ White's only move is Kg2.
  const CHECKED = "7k/6pp/8/8/3R4/8/1r1p3P/7K w - - 0 1";
  const TRAP = game(["Rd3"], CHECKED);

  function trap(): FakeEngine {
    const start = TRAP.fens[0];
    return new FakeEngine()
      .script(start, SCAN, [["d4d7", cp(300)]])
      .script(TRAP.fens[1], SCAN, [["b2b1", cp(300)]])
      .script(start, VERIFY, [
        ["d4d7", cp(300)],
        ["d4d3", cp(-300)]
      ])
      .script(after(start, "d4d7"), VERIFY, [["b2b1", cp(-300)]])
      .script(after(start, "d4d7", "b2b1"), VERIFY, [["h1g2", cp(300)]]);
  }

  it("drops trailing solver moves that were the only legal move", async () => {
    await expect(generateGamePuzzles(input(TRAP, trap()))).resolves.toMatchObject([
      { solution: ["d4d7"] }
    ]);
  });

  it("keeps an only move inside the line", async () => {
    const start = TRAP.fens[0];
    const engine = trap()
      .script(after(start, "d4d7", "b2b1", "h1g2"), VERIFY, [["b1e1", cp(-300)]])
      .script(after(start, "d4d7", "b2b1", "h1g2", "b1e1"), VERIFY, [
        ["d7d8", cp(300)],
        ["d7c7", cp(-300)]
      ]);
    await expect(generateGamePuzzles(input(TRAP, engine))).resolves.toMatchObject([
      { solution: ["d4d7", "b2b1", "h1g2", "b1e1", "d7d8"] }
    ]);
  });
});

describe("generateGamePuzzles: skipped positions", () => {
  it("never starts a puzzle where there was only one legal move", async () => {
    const forced = game(["Kg2"], after("7k/6pp/8/8/3R4/8/1r1p3P/7K w - - 0 1", "d4d7", "b2b1"));
    const engine = scriptScan(new FakeEngine(), forced, [0, -300]);
    await expect(generateGamePuzzles(input(forced, engine))).resolves.toStrictEqual([]);
  });

  it("skips a position repeated since the last irreversible move", async () => {
    // 1.Nf3 Nf6 2.Ng1 Ng8 3.Nf3: the start position again, with the same mistake.
    const shuffle = game(["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6"]);
    const engine = scriptScan(new FakeEngine(), shuffle, [0, -300, -300, -300, 0, -300, -300], {
      0: "e2e4"
    }).script(START_FEN, VERIFY, [
      ["e2e4", cp(300)],
      ["d2d4", cp(-300)]
    ]);
    const puzzles = await generateGamePuzzles(input(shuffle, engine, { kinds: ["mistake"] }));
    expect(puzzles.map((puzzle) => puzzle.ply)).toStrictEqual([1]);
  });

  it("skips book moves", async () => {
    const openingBook = parseOpeningBook(
      ["1\te2e4", "2\te7e5", "3\tg1f3", "4\tb8c6", "5\tf1c4\tC50\tItalian Game"].join("\n")
    );
    const puzzles = await generateGamePuzzles(input(OPEN, openMistake(), { openingBook }));
    expect(puzzles).toStrictEqual([]);
  });
});

/** A yield hook that aborts `controller` on its `wait`-th call. */
function abortOnWait(controller: AbortController, wait: number): () => Promise<void> {
  let waits = 0;
  return () => {
    waits += 1;
    if (waits === wait) controller.abort();
    return Promise.resolve();
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("generateGamePuzzles: cancellation and yielding", () => {
  it("rejects without searching once aborted", async () => {
    const engine = openMistake();
    const signal = AbortSignal.abort();
    await expect(generateGamePuzzles(input(OPEN, engine, { signal }))).rejects.toMatchObject({
      name: "AbortError"
    });
    expect(engine.searches).toHaveLength(0);
  });

  it("stops searching as soon as it is aborted", async () => {
    const engine = openMistake();
    const controller = new AbortController();
    // The third search never starts.
    const beforeSearch = abortOnWait(controller, 3);
    await expect(
      generateGamePuzzles(input(OPEN, engine, { signal: controller.signal, beforeSearch }))
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(engine.searches).toHaveLength(2);
  });

  it("waits for the yield hook before searching", async () => {
    const engine = openMistake();
    const entered = deferred();
    const gate = deferred();
    const beforeSearch = () => {
      entered.resolve();
      return gate.promise;
    };
    const run = generateGamePuzzles(input(OPEN, engine, { beforeSearch }));
    await entered.promise;
    expect(engine.searches).toHaveLength(0);
    gate.resolve();
    await expect(run).resolves.toHaveLength(1);
  });
});

describe("scanFromReview", () => {
  function analysisLine(uci: string, score: EngineScore): AnalysisLine {
    return { multipv: 1, depth: 18, score, scoreWhite: score, pv: [uci] };
  }

  /** A review of OPEN with OPEN_EVALS, 4.d4 its best move at index 4. */
  function review(): Pick<GameReview, "moves"> {
    const moves = OPEN.moves.map((uci, index): MoveReview => {
      const fenBefore = OPEN.fens[index];
      const turn = positionFromFen(fenBefore).turn;
      const white = cp(OPEN_EVALS[index] ?? 0);
      const score = turn === "white" ? white : invertScore(white);
      const best = index === 4 ? "d2d4" : (legalUcis(fenBefore).find((m) => m !== uci) ?? "");
      return {
        nodeId: `n${index}`,
        ply: index + 1,
        san: "",
        playedMove: uci,
        fenBefore,
        fenAfter: OPEN.fens[index + 1],
        evalBefore: white,
        evalAfter: cp(OPEN_EVALS[index + 1] ?? 0),
        evalLoss: null,
        bestMove: best,
        bestLine: [best],
        topLines: [analysisLine(best, score)],
        motifs: []
      };
    });
    return { moves: moves.reverse() };
  }

  it("runs only the deep check on a reviewed game", async () => {
    const engine = new FakeEngine().script(OPEN.fens[4], VERIFY, [
      ["d2d4", cp(300)],
      ["b1c3", cp(-300)]
    ]);
    const scan = scanFromReview(review(), OPEN.moves);
    const puzzles = await generateGamePuzzles(input(OPEN, engine, { scan }));
    expect(puzzles).toMatchObject([{ kind: "mistake", ply: 5, solution: ["d2d4"] }]);
    expect(engine.searches.map((search) => search.search.depth)).not.toContain(SCAN);
  });

  it("reads a move's stored evaluation (White's view) when it has no lines", () => {
    const moves = review().moves.map((move) => ({ ...move, topLines: [] }));
    const scan = scanFromReview({ moves }, OPEN.moves);
    // Black to move at index 5: White's −3.00 is Black's +3.00.
    expect(scan?.[5]).toStrictEqual({
      score: cp(300),
      bestMove: moves.find((move) => move.ply === 6)?.bestMove
    });
    // The end position has no reply lines: its stored evaluation, from the side to move.
    expect(scan?.[8]).toStrictEqual({ score: cp(-300), bestMove: null });
  });

  it("is null for a review of other moves", () => {
    expect(scanFromReview(review(), OPEN.moves.slice(1))).toBeNull();
    expect(scanFromReview(review(), [...OPEN.moves.slice(0, -1), "h2h3"])).toBeNull();
  });
});

describe("userSideOfGame", () => {
  it.each([
    [{ white: "Magnus", black: "Hikaru" }, ["magnus"], "white"],
    [{ white: "Magnus", black: " hikaru " }, ["someone", "HIKARU"], "black"],
    [{ white: "Magnus", black: "Hikaru" }, ["fabi"], null],
    [{ white: "Magnus", black: "magnus" }, ["Magnus"], null],
    [{ white: null, black: "" }, [""], null]
  ])("finds the user in %o for %o", (players, usernames, side) => {
    expect(userSideOfGame(players, usernames)).toBe(side);
  });
});
