import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import type { GeneratedPuzzle } from "@chaturanga/shared/chess/puzzle-generator";
import { LAPSE_RETRY_MS } from "@chaturanga/shared/chess/repertoire-scheduler";
import type { GameSource } from "@chaturanga/shared/types/chess";
import {
  DEFAULT_GAME_PUZZLE_SETTINGS,
  type GamePuzzleSettings
} from "@chaturanga/shared/types/game-puzzles";

const userData = mkdtempSync(join(tmpdir(), "chaturanga-game-puzzles-test-"));
vi.mock("electron", () => ({ app: { getPath: () => userData } }));

const { closeDb, getDb } = await import("../db");
const { gameRepository, settingsRepository } = await import("../db/repositories");
const { gamePuzzleRepository: repository } = await import("./repository");

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 20, 12);
const USERNAMES = ["Me"];

/** A library game played at `playedAt` (the set lists newer games first). */
function saveGame(
  id: string,
  options: {
    source?: GameSource;
    white?: string;
    black?: string;
    timeControl?: string;
    playedAt?: number;
  } = {}
): string {
  const { game } = importPgnText(`[Event "Casual"]
[White "${options.white ?? "Me"}"]
[Black "${options.black ?? "Rival"}"]
[Date "2026.10.04"]
[TimeControl "${options.timeControl ?? "600+0"}"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 *`);
  gameRepository.saveImported(
    { ...game, id, source: options.source ?? "lichess" },
    options.playedAt ?? T0
  );
  return id;
}

function puzzle(ply: number, patch: Partial<GeneratedPuzzle> = {}): GeneratedPuzzle {
  return {
    ply,
    kind: "mistake",
    tags: [],
    solverSide: ply % 2 === 1 ? "white" : "black",
    startFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    setupMove: "e2e4",
    solution: ["g1f3"],
    playedMove: "d2d4",
    winBefore: 60,
    winAfter: 40,
    difficulty: 1500,
    difficultyCapped: false,
    userChance: 0.4,
    chanceRating: 1500,
    themes: ["fork"],
    positionKey: `key-${ply}`,
    generatorVersion: 1,
    depths: { scan: 12, verify: 20 },
    ...patch
  };
}

function settings(patch: Partial<GamePuzzleSettings> = {}): GamePuzzleSettings {
  return {
    ...DEFAULT_GAME_PUZZLE_SETTINGS,
    sources: [...DEFAULT_GAME_PUZZLE_SETTINGS.sources],
    timeControls: [...DEFAULT_GAME_PUZZLE_SETTINGS.timeControls],
    kinds: [...DEFAULT_GAME_PUZZLE_SETTINGS.kinds],
    limit: null,
    ...patch
  };
}

const idsOf = (puzzles: readonly { id: string }[]) => puzzles.map((item) => item.id);
const idAt = (gameId: string, ply: number) =>
  repository.list({}, T0).puzzles.find((item) => item.gameId === gameId && item.ply === ply)?.id;

describe("gamePuzzleRepository (SQLite)", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM games");
    getDb().exec("DELETE FROM settings");
  });

  afterAll(() => {
    closeDb();
    rmSync(userData, { recursive: true, force: true });
  });

  it("re-processing replaces the kinds that ran and keeps the progress of unchanged puzzles", () => {
    saveGame("g1");
    repository.savePuzzles(
      "g1",
      ["mistake", "hard-find"],
      [puzzle(3), puzzle(5, { kind: "hard-find" }), puzzle(7)]
    );
    const kept = idAt("g1", 3)!;
    const changed = idAt("g1", 7)!;
    repository.recordAttempt({ puzzleId: kept, outcome: "unaided" }, T0);
    repository.recordAttempt({ puzzleId: changed, outcome: "unaided" }, T0);

    // Only mistakes ran: ply 3 is the same puzzle, ply 7's solution changed, ply 9 is new; the
    // hard find at ply 5 stays as it was.
    repository.savePuzzles(
      "g1",
      ["mistake"],
      [puzzle(3, { winBefore: 70 }), puzzle(7, { solution: ["b1c3"] }), puzzle(9)]
    );

    const puzzles = repository.list({}, T0).puzzles.sort((a, b) => a.ply - b.ply);
    expect(puzzles.map((item) => [item.ply, item.kind])).toStrictEqual([
      [3, "mistake"],
      [5, "hard-find"],
      [7, "mistake"],
      [9, "mistake"]
    ]);
    const atPly = (ply: number) => puzzles.find((item) => item.ply === ply)!;
    expect(atPly(3)).toMatchObject({ id: kept, winBefore: 70, progress: { attempts: 1 } });
    expect(atPly(7).id).not.toBe(changed);
    expect(atPly(7).progress).toStrictEqual({
      stage: 0,
      dueAt: null,
      lapses: 0,
      lastAttemptAt: null,
      lastOutcome: null,
      attempts: 0
    });
  });

  it("a run that no longer finds a kind's puzzle removes it", () => {
    saveGame("g1");
    repository.savePuzzles("g1", ["mistake"], [puzzle(3), puzzle(5)]);
    repository.savePuzzles("g1", ["mistake"], [puzzle(5)]);
    expect(repository.list({}, T0).puzzles.map((item) => item.ply)).toStrictEqual([5]);
  });

  it("orders the set: due puzzles oldest due first, then new ones newest game first", () => {
    saveGame("older", { playedAt: T0 - 2 * DAY });
    saveGame("newer", { playedAt: T0 - DAY });
    repository.savePuzzles("older", ["mistake"], [puzzle(3), puzzle(5), puzzle(7)]);
    repository.savePuzzles("newer", ["mistake"], [puzzle(3), puzzle(5)]);
    const older3 = idAt("older", 3)!;
    const older5 = idAt("older", 5)!;
    const newer5 = idAt("newer", 5)!;
    // Due again 10 minutes after each wrong try; one solved cleanly is due tomorrow.
    repository.recordAttempt({ puzzleId: newer5, outcome: "wrong" }, T0 - 2 * LAPSE_RETRY_MS);
    repository.recordAttempt({ puzzleId: older5, outcome: "reveal" }, T0 - 3 * LAPSE_RETRY_MS);
    repository.recordAttempt({ puzzleId: older3, outcome: "unaided" }, T0);

    const list = repository.list({}, T0);
    expect(list.puzzles.map((item) => [item.gameId, item.ply])).toStrictEqual([
      ["older", 5],
      ["newer", 5],
      ["newer", 3],
      ["older", 7],
      ["older", 3]
    ]);
    expect(list).toMatchObject({ total: 5, due: 4 });
    expect(repository.next({ excludeIds: [older5] }, T0)?.id).toBe(newer5);
    // Nothing due or new left: the one due tomorrow isn't offered.
    const shown = idsOf(list.puzzles).filter((id) => id !== older3);
    expect(repository.next({ excludeIds: shown }, T0)).toBeNull();
    expect(repository.list({ excludeIds: [older5], limit: 2 }, T0)).toMatchObject({
      total: 5,
      due: 4,
      puzzles: [{ id: newer5 }, { gameId: "newer", ply: 3 }]
    });
  });

  it("filters by kind, difficulty (2600 takes 2600+) and game source", () => {
    saveGame("lichess", { playedAt: T0 - DAY });
    saveGame("imported", { source: "pgn-import" });
    saveGame("engine", { source: "engine-game" });
    repository.savePuzzles(
      "lichess",
      ["mistake", "tricky"],
      [
        puzzle(3, { difficulty: 1200 }),
        puzzle(5, { kind: "tricky", difficulty: 2000 }),
        puzzle(7, { difficulty: null, difficultyCapped: true }),
        puzzle(9, { difficulty: null })
      ]
    );
    repository.savePuzzles("imported", ["mistake"], [puzzle(3, { difficulty: 1800 })]);
    repository.savePuzzles("engine", ["mistake"], [puzzle(3)]);
    const plies = (query: Parameters<typeof repository.list>[0]) =>
      repository.list(query, T0).puzzles.map((item) => `${item.game.source}:${item.ply}`);

    // An engine game isn't one of "My games".
    expect(plies({})).toStrictEqual([
      "imported:3",
      "lichess:3",
      "lichess:5",
      "lichess:7",
      "lichess:9"
    ]);
    expect(plies({ kinds: ["tricky"] })).toStrictEqual(["lichess:5"]);
    expect(plies({ sources: ["imported"] })).toStrictEqual(["imported:3"]);
    expect(plies({ difficulty: { min: 1000, max: 1900 } })).toStrictEqual([
      "imported:3",
      "lichess:3"
    ]);
    expect(plies({ difficulty: { min: 1900, max: 2600 } })).toStrictEqual([
      "lichess:5",
      "lichess:7"
    ]);
    expect(plies({ difficulty: null })).toHaveLength(5);
  });

  it("shows what the session reveals at the end: the opponent, date and move number", () => {
    saveGame("g1", { white: "Rival", black: "me" });
    repository.savePuzzles(
      "g1",
      ["mistake", "opponent-chance"],
      [
        puzzle(4, { solverSide: "black" }),
        puzzle(5, { kind: "opponent-chance", solverSide: "white" })
      ]
    );
    const [mine, theirs] = repository.list({}, T0).puzzles;
    expect(mine.game).toStrictEqual({
      source: "lichess",
      opponent: "Rival",
      date: "2026.10.04",
      moveNumber: 2
    });
    // Solved as the opponent: the opponent is still the other player.
    expect(theirs.game).toMatchObject({ opponent: "Rival", moveNumber: 3 });
  });

  it("schedules attempts: a clean solve advances, a wrong move or the solution lapses", () => {
    saveGame("g1");
    repository.savePuzzles("g1", ["mistake"], [puzzle(3)]);
    const id = idAt("g1", 3)!;
    expect(repository.recordAttempt({ puzzleId: id, outcome: "unaided" }, T0)).toStrictEqual({
      stage: 1,
      dueAt: T0 + DAY,
      lapses: 0,
      lastAttemptAt: T0,
      lastOutcome: "unaided",
      attempts: 1
    });
    const later = T0 + 2 * DAY;
    expect(repository.recordAttempt({ puzzleId: id, outcome: "reveal" }, later)).toStrictEqual({
      stage: 0,
      dueAt: later + LAPSE_RETRY_MS,
      lapses: 1,
      lastAttemptAt: later,
      lastOutcome: "reveal",
      attempts: 2
    });
    expect(() => repository.recordAttempt({ puzzleId: "gone", outcome: "wrong" }, T0)).toThrow(
      /no longer/
    );
  });

  it("counts the card: games per source, eligible, processed, puzzles and due", () => {
    saveGame("mine");
    saveGame("theirs", { white: "Someone", black: "Else" });
    saveGame("imported", { source: "pgn-import", black: "ME", white: "Rival" });
    saveGame("engine", { source: "engine-game" });
    repository.savePuzzles("mine", ["mistake"], [puzzle(3), puzzle(5)]);
    repository.recordAttempt({ puzzleId: idAt("mine", 3)!, outcome: "unaided" }, T0);
    const queued = { kinds: [...DEFAULT_GAME_PUZZLE_SETTINGS.kinds], depth: "quick" as const };
    repository.enqueue([
      { gameId: "mine", source: "dialog", settings: queued, scan: null },
      { gameId: "theirs", source: "dialog", settings: queued, scan: null }
    ]);
    repository.takeNext();
    repository.finish({ gameId: "mine", status: "done", puzzlesFound: 2, error: null });

    expect(repository.summary(USERNAMES, T0)).toStrictEqual({
      sources: {
        lichess: { games: 2, eligible: 1, processed: 1, puzzles: 2 },
        chesscom: { games: 0, eligible: 0, processed: 0, puzzles: 0 },
        imported: { games: 1, eligible: 1, processed: 0, puzzles: 0 }
      },
      puzzles: 2,
      due: 1
    });
  });

  it("matches games for the dialog: sources, time controls, processed, limit, no user side", () => {
    saveGame("blitz", { timeControl: "180+2", playedAt: T0 });
    saveGame("rapid", { timeControl: "600+0", playedAt: T0 - DAY });
    saveGame("rapid-old", { timeControl: "900+10", playedAt: T0 - 2 * DAY });
    saveGame("strangers", { white: "A", black: "B", playedAt: T0 - 3 * DAY });
    saveGame("chesscom", { source: "chesscom", playedAt: T0 - 4 * DAY });
    const queued = { kinds: ["mistake" as const], depth: "quick" as const };
    for (const [gameId, status] of [
      ["rapid", "done"],
      ["rapid-old", "failed"]
    ] as const) {
      repository.enqueue([{ gameId, source: "dialog", settings: queued, scan: null }]);
      repository.takeNext();
      repository.finish({ gameId, status, puzzlesFound: 0, error: null });
    }

    // A failed game isn't processed: it is tried again.
    expect(repository.matchingGames(settings(), USERNAMES)).toStrictEqual({
      ids: ["blitz", "rapid-old", "chesscom"],
      withoutUserSide: 1
    });
    expect(
      repository.matchingGames(settings({ skipProcessed: false, limit: 25 }), USERNAMES).ids
    ).toStrictEqual(["blitz", "rapid", "rapid-old", "chesscom"]);
    expect(
      repository.matchingGames(
        settings({ sources: ["lichess"], timeControls: ["rapid"] }),
        USERNAMES
      )
    ).toStrictEqual({ ids: ["rapid-old"], withoutUserSide: 1 });
    expect(repository.summary(USERNAMES, T0).sources.lichess.processed).toBe(1);
    // A game already queued isn't queued twice.
    repository.enqueue([{ gameId: "blitz", source: "dialog", settings: queued, scan: null }]);
    expect(repository.matchingGames(settings(), USERNAMES).ids).toStrictEqual([
      "rapid-old",
      "chesscom"
    ]);
  });

  it("a cancelled queue drops games never processed and restores the others' last result", () => {
    saveGame("done-before");
    saveGame("new-one");
    const queued = { kinds: ["mistake" as const], depth: "quick" as const };
    const entry = (gameId: string) => ({
      gameId,
      source: "dialog" as const,
      settings: queued,
      scan: null
    });
    repository.enqueue([entry("done-before")]);
    repository.takeNext();
    repository.finish({ gameId: "done-before", status: "skipped", puzzlesFound: 0, error: null });
    expect(repository.batchCounts()).toStrictEqual({ done: 1, total: 1 });

    // The queue was empty: a new batch.
    expect(repository.enqueue([entry("done-before"), entry("new-one")])).toBe(2);
    expect(repository.batchCounts()).toStrictEqual({ done: 0, total: 2 });
    repository.cancelQueue();
    expect(repository.batchCounts()).toStrictEqual({ done: 0, total: 0 });
    expect(repository.hasQueued()).toBe(false);
    expect(repository.summary(USERNAMES, T0).sources.lichess.processed).toBe(1);
    expect(repository.matchingGames(settings(), USERNAMES).ids).toStrictEqual(["new-one"]);
  });

  it("deleting a game removes its puzzles, their progress and its queue row", () => {
    saveGame("g1");
    repository.savePuzzles("g1", ["mistake"], [puzzle(3)]);
    repository.recordAttempt({ puzzleId: idAt("g1", 3)!, outcome: "wrong" }, T0);
    repository.enqueue([
      { gameId: "g1", source: "review", settings: { kinds: ["mistake"], depth: "deep" }, scan: [] }
    ]);
    gameRepository.remove("g1");
    const count = (table: string) =>
      Number(getDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n);
    expect([
      count("game_puzzles"),
      count("game_puzzle_progress"),
      count("puzzle_generation_games")
    ]).toStrictEqual([0, 0, 0]);
    expect(() => repository.savePuzzles("g1", ["mistake"], [puzzle(3)])).toThrow(/deleted/);
  });

  it("leaves out a puzzle whose stored solution can't be read", () => {
    saveGame("g1");
    repository.savePuzzles("g1", ["mistake"], [puzzle(3), puzzle(5)]);
    getDb().prepare("UPDATE game_puzzles SET solution_json = '{' WHERE ply = 3").run();
    expect(repository.list({}, T0)).toMatchObject({ total: 2, puzzles: [{ ply: 5 }] });
  });

  it("keeps the paused state and the last-used settings out of the app settings", () => {
    expect(repository.lastSettings()).toStrictEqual(DEFAULT_GAME_PUZZLE_SETTINGS);
    expect(repository.paused()).toBe(false);
    const chosen = settings({ kinds: ["mistake"], depth: "deep", limit: 25 });
    repository.setLastSettings(chosen);
    repository.setPaused(true);
    expect(repository.lastSettings()).toStrictEqual(chosen);
    expect(repository.paused()).toBe(true);
    expect(Object.keys(settingsRepository.getAll()).some((key) => key.includes("."))).toBe(false);
    // Unreadable settings read as the defaults.
    getDb().prepare("UPDATE settings SET value = '{\"depth\":1}' WHERE key LIKE 'main.%'").run();
    expect(repository.lastSettings()).toStrictEqual(DEFAULT_GAME_PUZZLE_SETTINGS);
  });
});
