import { rmSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import { START_FEN } from "@chaturanga/shared/chess/position";
import { positionKey } from "@chaturanga/shared/chess/repertoire-position";
import type { GameSource } from "@chaturanga/shared/types/chess";
import {
  DEFAULT_INSIGHTS_FILTERS,
  type InsightsFilters
} from "@chaturanga/shared/types/repertoire-insights";
import { serviceHelpers } from "../repertoire/__fixtures__/repertoire-builders";

const env = await vi.hoisted(async () => import("../repertoire/__fixtures__/service-env"));
vi.mock("electron", () => env.electronModule);

const { closeDb, getDb } = await import("../db");
const { gameRepository } = await import("../db/repositories");
const service = await import("../repertoire/service");
const { GamePositionIndexer, gamePositionIndex } = await import("./position-index");
const { explorerGames } = await import("./explorer");
const { create, save } = serviceHelpers(service);

const NOW = Date.UTC(2026, 9, 20, 12);
const START_KEY = positionKey(START_FEN);
let usernames: string[] | null = ["Me"];

type GameOptions = {
  white?: string;
  black?: string;
  result?: string;
  event?: string;
  date?: string;
  timeControl?: string;
  source?: GameSource;
};

function saveGame(id: string, moves: string, options: GameOptions = {}): void {
  const result = options.result ?? "*";
  const { game } = importPgnText(`[Event "${options.event ?? "Rated Blitz game"}"]
[Site "https://example.com/${id}"]
[White "${options.white ?? "Me"}"]
[Black "${options.black ?? "Rival"}"]
[Date "${options.date ?? "2026.10.04"}"]
[TimeControl "${options.timeControl ?? "180+0"}"]
[Result "${result}"]

${moves} ${result}`);
  gameRepository.saveImported({ ...game, id, source: options.source ?? "lichess" }, NOW);
}

async function index(): Promise<void> {
  const indexer = new GamePositionIndexer({ usernames: () => Promise.resolve(usernames) });
  indexer.kick();
  await indexer.idle();
}

const filters = (patch: Partial<InsightsFilters> = {}): InsightsFilters => ({
  ...DEFAULT_INSIGHTS_FILTERS,
  timeControls: [...DEFAULT_INSIGHTS_FILTERS.timeControls],
  accounts: [...DEFAULT_INSIGHTS_FILTERS.accounts],
  ...patch
});

const tally = (patch: Partial<InsightsFilters> = {}) =>
  gamePositionIndex
    .moves(START_KEY, filters(patch), NOW)
    .map(({ uci, games, wins, draws, losses }) => [uci, games, wins, draws, losses]);

describe("game position index", () => {
  beforeEach(async () => {
    getDb().exec("DELETE FROM games");
    getDb().exec("DELETE FROM repertoires");
    usernames = ["Me"];
    saveGame("won-as-white", "1. e4 e5 2. Nf3", { result: "1-0" });
    // The opponent's 1.e4 counts too, scored from the user's side (Black won).
    saveGame("won-as-black", "1. e4 c5", { white: "Rival", black: "Me", result: "0-1" });
    saveGame("old-casual-loss", "1. e4 e5", {
      result: "0-1",
      event: "Casual Blitz game",
      date: "2025.01.01"
    });
    saveGame("chesscom-draw", "1. d4 d5", {
      result: "1/2-1/2",
      event: "Live Chess",
      timeControl: "600",
      source: "chesscom"
    });
    // Back to the start position at move 3: it counts once, by its first move there.
    saveGame("repeated", "1. Nf3 Nf6 2. Ng1 Ng8 3. e4");
    // Neither player is a connected account.
    saveGame("not-mine", "1. e4 e5", { white: "Someone", black: "Else", result: "1-0" });
    await index();
  });

  afterAll(() => {
    closeDb();
    rmSync(env.userData, { recursive: true, force: true });
  });

  it("tallies each move at a position from the user's side, each game once", () => {
    expect(tally()).toStrictEqual([
      ["e2e4", 3, 2, 0, 1],
      ["d2d4", 1, 0, 1, 0],
      ["g1f3", 1, 0, 0, 0]
    ]);
    expect(gamePositionIndex.progress()).toStrictEqual({ done: 6, total: 6 });
  });

  it("follows the Insights filters", () => {
    expect(tally({ ratedOnly: true })).toStrictEqual([
      ["e2e4", 2, 2, 0, 0],
      // Chess.com doesn't say casual: it counts as rated.
      ["d2d4", 1, 0, 1, 0],
      ["g1f3", 1, 0, 0, 0]
    ]);
    expect(tally({ timeControls: ["rapid"] })).toStrictEqual([["d2d4", 1, 0, 1, 0]]);
    expect(tally({ accounts: ["chesscom"] })).toStrictEqual([["d2d4", 1, 0, 1, 0]]);
    expect(tally({ accounts: [] })).toStrictEqual([]);
    expect(tally({ period: "1y" })[0]).toStrictEqual(["e2e4", 2, 2, 0, 0]);
  });

  it("reads a changed game again, drops a deleted one, and starts over for other accounts", async () => {
    const draw = gameRepository.get("chesscom-draw")!;
    const { game } = importPgnText(`[White "Me"]
[Black "Rival"]
[Result "1-0"]

1. c4 e5 1-0`);
    gameRepository.save({ ...draw, ...game, id: draw.id, source: "chesscom" });
    gameRepository.remove("won-as-white");
    await index();
    expect(tally()).toStrictEqual([
      ["e2e4", 2, 1, 0, 1],
      ["c2c4", 1, 1, 0, 0],
      ["g1f3", 1, 0, 0, 0]
    ]);

    // Rival's games are the user's now: their side and results flip.
    usernames = ["Rival"];
    await index();
    expect(tally()).toStrictEqual([
      ["e2e4", 2, 1, 0, 1],
      ["c2c4", 1, 0, 0, 1],
      ["g1f3", 1, 0, 0, 0]
    ]);
  });

  it("keeps the index when an account can't be read", async () => {
    usernames = null;
    await index();
    expect(tally()[0]).toStrictEqual(["e2e4", 3, 2, 0, 1]);
  });

  it("marks the repertoire's moves and names each move in SAN", () => {
    const { id } = create();
    save(id, [["e2e4", "e7e5"]]);
    const games = explorerGames({ repertoireId: id, fen: START_FEN }, filters(), null, NOW);
    expect(
      games.moves.map(({ san, inRepertoire, score }) => ({ san, inRepertoire, score }))
    ).toStrictEqual([
      { san: "e4", inRepertoire: true, score: 2 / 3 },
      { san: "d4", inRepertoire: false, score: 0.5 },
      // No decided game: no score.
      { san: "Nf3", inRepertoire: false, score: null }
    ]);
    expect(games.moves[0].lastPlayedAt).toBe(Date.UTC(2026, 9, 4));
  });
});
