import { rmSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import { fenAfterUci, START_FEN } from "@chaturanga/shared/chess/position";
import { LAPSE_RETRY_MS } from "@chaturanga/shared/chess/repertoire-scheduler";
import { positionKey } from "@chaturanga/shared/chess/repertoire-position";
import type { GameSource } from "@chaturanga/shared/types/chess";
import type { InsightsComparerStatus } from "@chaturanga/shared/types/repertoire-insights";
import { serviceHelpers } from "../repertoire/__fixtures__/repertoire-builders";

const env = await vi.hoisted(async () => import("../repertoire/__fixtures__/service-env"));
vi.mock("electron", () => env.electronModule);
/** Every stored JSON text read (the comparer reads reviews through it). */
const jsonReads = vi.hoisted((): string[] => []);
vi.mock("../stored-json", () => ({
  parseStoredJson: (text: string): unknown => {
    jsonReads.push(text);
    return JSON.parse(text);
  }
}));

const { closeDb, getDb } = await import("../db");
const { gameRepository } = await import("../db/repositories");
const service = await import("../repertoire/service");
const { progressRepository } = await import("../repertoire/repository");
const { InsightsComparer } = await import("./comparer");
const { insightsRepository } = await import("./repository");
const { insightsGamesPage, insightsReport } = await import("./report");
const { replyFrequencies, weakSpotPositions } = await import("./weak-spots");
const { create, save } = serviceHelpers(service);

const DAY = 24 * 60 * 60_000;
/** "Now" for the comparer: games are played in the days before it. */
const T0 = Date.UTC(2026, 9, 20, 12);
let serviceNow = T0 - 20 * DAY;
service.setRepertoireClock(() => serviceNow);

/** The PGN date headers of a game played `daysAgo` days before T0. */
function dateHeaders(daysAgo: number): string {
  const at = new Date(T0 - daysAgo * DAY);
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = `${at.getUTCFullYear()}.${pad(at.getUTCMonth() + 1)}.${pad(at.getUTCDate())}`;
  const time = `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:00`;
  return `[UTCDate "${date}"]\n[UTCTime "${time}"]`;
}

let gameCounter = 0;

/** A library game with the user ("Me") on `color`'s side. */
function game(
  moves: string,
  options: {
    color?: "white" | "black";
    daysAgo?: number;
    result?: string;
    source?: GameSource;
    timeControl?: string;
    event?: string;
    opponent?: string;
  } = {}
): string {
  const color = options.color ?? "white";
  const opponent = options.opponent ?? "Rival";
  const result = options.result ?? "*";
  const { game: parsed } = importPgnText(`[Event "${options.event ?? "Rated Blitz game"}"]
[White "${color === "white" ? "Me" : opponent}"]
[Black "${color === "black" ? "Me" : opponent}"]
${dateHeaders(options.daysAgo ?? 1)}
[TimeControl "${options.timeControl ?? "180+0"}"]
[Result "${result}"]

${moves} ${result}`);
  const id = `g${++gameCounter}`;
  gameRepository.saveImported({ ...parsed, id, source: options.source ?? "lichess" }, T0);
  return id;
}

let usernames: string[] | null = ["Me"];
const statuses: InsightsComparerStatus[] = [];
const progressChanged: string[] = [];

function comparer() {
  return new InsightsComparer({
    usernames: async () => usernames,
    emit: (status) => statuses.push(status),
    progressChanged: (id) => progressChanged.push(id),
    write: async (work) => work(),
    now: () => T0,
    yieldTurn: async () => undefined
  });
}

const outcomeOf = (gameId: string) =>
  insightsRepository.forGame(gameId).map((row) => ({
    repertoireId: row.repertoireId,
    outcome: row.outcome,
    ply: row.ply,
    matchedPlies: row.matchedPlies
  }));

/** The position after `ucis` from the start. */
function keyAfter(ucis: string[]): string {
  let fen = START_FEN;
  for (const uci of ucis) fen = fenAfterUci(fen, uci)!;
  return positionKey(fen);
}

const RUY = ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"];

/** The decision at `key` was last practised `daysAgo` days before T0 (stage 2). */
function practised(repertoireId: string, key: string, daysAgo: number) {
  const fingerprint = getDb()
    .prepare(
      "SELECT acceptance_fingerprint FROM repertoire_decisions WHERE repertoire_id = ? AND position_key = ?"
    )
    .get(repertoireId, key)?.acceptance_fingerprint;
  progressRepository.upsert({
    repertoireId,
    positionKey: key,
    stage: 2,
    dueAt: T0 + DAY,
    lastAttemptAt: T0 - daysAgo * DAY,
    lapses: 0,
    unaidedSuccesses: 2,
    acceptanceFingerprint: String(fingerprint),
    schedulerVersion: 1,
    suspended: false
  });
}

/** A stored review of a game whose moves mark it, so its reads can be told apart. */
function review(gameId: string, marker: string) {
  getDb()
    .prepare(
      `INSERT INTO game_reviews (review_id, game_id, created_at, review_json)
        VALUES (?, ?, ?, ?)`
    )
    .run(`review-${gameId}`, gameId, T0, JSON.stringify({ marker, moves: [] }));
}

const sans = (moves: readonly { san: string }[]) => moves.map((move) => move.san).join(" ");
const byUci = (a: { uci: string }, b: { uci: string }) => a.uci.localeCompare(b.uci);

describe("Insights comparer", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM repertoires");
    getDb().exec("DELETE FROM games");
    getDb().exec("DELETE FROM settings WHERE key LIKE 'main.repertoireInsights.%'");
    statuses.length = 0;
    progressChanged.length = 0;
    jsonReads.length = 0;
    usernames = ["Me"];
    serviceNow = T0 - 20 * DAY;
  });

  afterAll(() => {
    service.setRepertoireClock();
    closeDb();
    rmSync(env.userData, { recursive: true, force: true });
  });

  it("stores each game's outcome against the repertoires of the user's colour", async () => {
    const { id } = create("white");
    save(id, [RUY, ["e2e4", "e7e5", "g1f3", "d7d6", "d2d4"]]);
    const forgot = game("1. e4 e5 2. Bc4 Nc6");
    const newReply = game("1. e4 e5 2. Nf3 f5 3. exf5");
    const inBook = game("1. e4 e5 2. Nf3 Nc6 3. Bb5");
    const ended = game("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4");
    const otherOpening = game("1. d4 d5");
    const asBlack = game("1. e4 c5", { color: "black" });
    const nobody = game("1. e4 e5", { opponent: "Someone", color: "white" });
    getDb().exec(`UPDATE games SET white = 'Stranger' WHERE id = '${nobody}'`);
    await comparer().kick();

    expect(outcomeOf(forgot)).toStrictEqual([
      { repertoireId: id, outcome: "forgot", ply: 3, matchedPlies: 2 }
    ]);
    expect(outcomeOf(newReply)).toStrictEqual([
      { repertoireId: id, outcome: "new-reply", ply: 4, matchedPlies: 3 }
    ]);
    expect(outcomeOf(inBook)).toStrictEqual([
      { repertoireId: id, outcome: "in-book", ply: null, matchedPlies: 5 }
    ]);
    expect(outcomeOf(ended)).toMatchObject([{ outcome: "ended-in-book", ply: 6 }]);
    expect(outcomeOf(otherOpening)).toMatchObject([{ outcome: "forgot", ply: 1 }]);
    expect(outcomeOf(asBlack)).toMatchObject([{ repertoireId: null, outcome: "no-repertoire" }]);
    expect(outcomeOf(nobody)).toMatchObject([{ repertoireId: null, outcome: "no-user-side" }]);
    expect(statuses.at(-1)).toStrictEqual({ running: false, done: 7, total: 7 });

    const forgotRow = insightsRepository.forGame(forgot)[0];
    expect(forgotRow.expectedUcis).toStrictEqual(["g1f3"]);
    expect(forgotRow.positionKey).toBe(keyAfter(["e2e4", "e7e5"]));
    expect(forgotRow.moves.map((move) => move.san)).toStrictEqual(["e4", "e5", "Bc4"]);
  });

  it("follows transpositions and takes the outcome from the repertoire followed longest", async () => {
    const qgd = ["d2d4", "d7d5", "c2c4", "e7e6", "b1c3", "g8f6", "c1g5"];
    const nimzo = ["d2d4", "g8f6", "c2c4", "e7e6", "b1c3", "f8b4", "d1c2"];
    const { id: first } = create("white");
    save(first, [["e2e4", "e7e5"]]);
    serviceNow += 1;
    const { id: second } = create("white");
    save(second, [qgd, nimzo]);
    // 3…d5 isn't covered after 1…Nf6, but lands on the QGD position: the game stays in book.
    const transposed = game("1. d4 Nf6 2. c4 e6 3. Nc3 d5 4. Bg5", { daysAgo: 1 });
    const leftAfter = game("1. d4 Nf6 2. c4 e6 3. Nc3 d5 4. cxd5", { daysAgo: 2 });
    await comparer().kick();

    const best = (gameId: string) => outcomeOf(gameId).find((row) => row.repertoireId === second);
    expect(best(transposed)).toStrictEqual({
      repertoireId: second,
      outcome: "in-book",
      ply: null,
      matchedPlies: 7
    });
    expect(best(leftAfter)).toMatchObject({ outcome: "forgot", ply: 7, matchedPlies: 6 });
    expect(
      insightsRepository.forGame(leftAfter).find((row) => row.repertoireId === second)
    ).toMatchObject({ positionKey: keyAfter(qgd.slice(0, 6)), expectedUcis: ["c1g5"] });
    // Each game has a row per White repertoire; the report counts it with the longest one.
    expect(outcomeOf(transposed)).toHaveLength(2);
    const page = insightsGamesPage({ page: 0 }, T0);
    expect(page.rows.map((row) => [row.gameId, row.repertoireId, row.outcome])).toStrictEqual([
      [transposed, second, "in-book"],
      [leftAfter, second, "forgot"]
    ]);
  });

  it("compares again only what changed: the game, the repertoire, or the user's side", async () => {
    const { id } = create("white");
    save(id, [RUY]);
    const { id: black } = create("black");
    save(black, [["e2e4", "c7c5"]]);
    const whiteGame = game("1. e4 e5 2. Bc4");
    const blackGame = game("1. e4 c5 2. Nf3", { color: "black" });
    const run = comparer();
    await run.kick();
    expect(statuses.at(-1)).toMatchObject({ total: 2 });

    statuses.length = 0;
    await run.kick();
    expect(statuses).toStrictEqual([]);

    // An edit of the White repertoire bumps its revision: only White games are compared again.
    save(id, [RUY, ["e2e4", "e7e5", "f1c4"]]);
    await run.kick();
    expect(statuses.at(-1)).toStrictEqual({ running: false, done: 1, total: 1 });
    expect(outcomeOf(whiteGame)).toMatchObject([{ outcome: "in-book" }]);
    expect(outcomeOf(blackGame)).toMatchObject([{ outcome: "ended-in-book", ply: 3 }]);

    // The account is gone: neither game has a user side now.
    statuses.length = 0;
    usernames = [];
    await run.kick();
    expect(statuses.at(-1)).toMatchObject({ total: 2 });
    expect(outcomeOf(whiteGame)).toMatchObject([{ repertoireId: null, outcome: "no-user-side" }]);

    // A deleted game takes its rows with it.
    gameRepository.remove(whiteGame);
    expect(insightsRepository.forGame(whiteGame)).toStrictEqual([]);
  });

  it("compares an edit from the openings it read, reading a review only for a game that left the book", async () => {
    const { id } = create("white");
    save(id, [RUY]);
    const inBook = game("1. e4 e5 2. Nf3 Nc6 3. Bb5");
    const left = game("1. e4 e5 2. Nf3 Nc6 3. Bc4");
    review(inBook, "in-book review");
    review(left, "left review");
    const run = comparer();
    await run.kick();
    const reviewReads = () =>
      ["in-book review", "left review"].filter((marker) =>
        jsonReads.some((text) => text.includes(marker))
      );
    expect(reviewReads()).toStrictEqual(["left review"]);

    // The stored moves are gone (the row unchanged): an edit compares from what was read.
    jsonReads.length = 0;
    getDb().exec("UPDATE games SET move_tree_json = '[]', pgn = ''");
    const edited = save(id, [RUY, ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"]]);
    await run.kick();
    expect(statuses.at(-1)).toStrictEqual({ running: false, done: 2, total: 2 });
    expect(insightsRepository.forGame(left)).toMatchObject([
      { outcome: "in-book", revision: edited.repertoire.revision }
    ]);
    expect(reviewReads()).toStrictEqual([]);
  });

  it("doesn't compare a game it can't read again until it changes", async () => {
    const { id } = create("white");
    save(id, [RUY]);
    const damaged = game("1. e4 e5 2. Bc4");
    getDb().exec(`UPDATE games SET move_tree_json = '[]', pgn = '' WHERE id = '${damaged}'`);
    const run = comparer();
    await run.kick();
    expect(outcomeOf(damaged)).toStrictEqual([]);
    expect(statuses.at(-1)).toMatchObject({ done: 1, total: 1 });

    statuses.length = 0;
    await run.kick();
    expect(statuses).toStrictEqual([]);

    // Saved again (its row changed): read again.
    getDb().exec(`UPDATE games SET updated_at = updated_at + 1 WHERE id = '${damaged}'`);
    await run.kick();
    expect(statuses.at(-1)).toMatchObject({ done: 1, total: 1 });
  });

  it("skips a pass when an account can't be read, instead of taking it as disconnected", async () => {
    const { id } = create("white");
    save(id, [RUY]);
    const played = game("1. e4 e5 2. Bc4");
    const run = comparer();
    await run.kick();
    usernames = null;
    await run.kick();
    expect(outcomeOf(played)).toMatchObject([{ repertoireId: id, outcome: "forgot" }]);
  });

  describe("game misses", () => {
    const AFTER_E5 = keyAfter(["e2e4", "e7e5"]);

    it("sends a decision back to the start once per game, repertoire and position", async () => {
      const { id } = create("white");
      save(id, [RUY]);
      practised(id, AFTER_E5, 10);
      const missed = game("1. e4 e5 2. Bc4", { daysAgo: 2 });
      // Following the repertoire changes nothing.
      game("1. e4 e5 2. Nf3 Nc6 3. Bb5", { daysAgo: 1 });
      const run = comparer();
      await run.kick();

      expect(progressRepository.get(id, AFTER_E5)).toMatchObject({
        stage: 0,
        lapses: 1,
        dueAt: T0 + LAPSE_RETRY_MS,
        lastAttemptAt: T0,
        suspended: false
      });
      expect(progressRepository.get(id, positionKey(START_FEN))).toBeNull();
      expect(progressChanged).toStrictEqual([id]);

      // Compared again (the repertoire changed): the miss isn't applied twice.
      save(id, [RUY, ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"]]);
      await run.kick();
      expect(progressRepository.get(id, AFTER_E5)).toMatchObject({ lapses: 1 });
      expect(insightsRepository.hasMiss(missed, id, AFTER_E5)).toBe(true);
    });

    it("applies one miss per position for the games played before it, in this pass or a later one", async () => {
      const { id } = create("white");
      save(id, [RUY]);
      practised(id, AFTER_E5, 10);
      game("1. e4 e5 2. Bc4", { daysAgo: 3 });
      game("1. e4 e5 2. d4", { daysAgo: 4 });
      const run = comparer();
      await run.kick();
      expect(progressRepository.get(id, AFTER_E5)).toMatchObject({ lapses: 1 });

      // Another account's sync brings an older game (played before the miss was applied).
      game("1. e4 e5 2. Qh5", { daysAgo: 2, source: "chesscom" });
      await run.kick();
      expect(progressRepository.get(id, AFTER_E5)).toMatchObject({ lapses: 1 });
    });

    it("doesn't apply a miss again when the account reconnects and its games sync again", async () => {
      const { id } = create("white");
      save(id, [RUY]);
      practised(id, AFTER_E5, 10);
      game("1. e4 e5 2. Bc4", { daysAgo: 2 });
      const run = comparer();
      await run.kick();
      expect(progressRepository.get(id, AFTER_E5)).toMatchObject({ lapses: 1 });

      // Disconnecting deletes the account's games (and the misses noted with them).
      gameRepository.removeBySource("lichess");
      await run.kick();
      const again = game("1. e4 e5 2. Bc4", { daysAgo: 2 });
      await run.kick();
      expect(outcomeOf(again)).toMatchObject([{ outcome: "forgot" }]);
      expect(progressRepository.get(id, AFTER_E5)).toMatchObject({ lapses: 1 });
    });

    it("leaves positions never practised, and games played before the last practice, alone", async () => {
      const { id } = create("white");
      save(id, [RUY]);
      game("1. e4 e5 2. Bc4", { daysAgo: 2 });
      await comparer().kick();
      expect(progressRepository.get(id, AFTER_E5)).toBeNull();

      practised(id, AFTER_E5, 1);
      game("1. e4 e5 2. d4", { daysAgo: 3 });
      await comparer().kick();
      expect(progressRepository.get(id, AFTER_E5)).toMatchObject({ stage: 2, lapses: 0 });
    });

    it("leaves old games, games before the move was accepted, and paused decisions alone", async () => {
      const { id } = create("white");
      const saved = save(id, [RUY]);
      practised(id, AFTER_E5, 40);
      game("1. e4 e5 2. Bc4", { daysAgo: 31 });
      // Played before the repertoire had the move.
      game("1. e4 e5 2. d4", { daysAgo: 25 });
      await comparer().kick();
      expect(progressRepository.get(id, AFTER_E5)).toMatchObject({ lapses: 0 });

      service.updateDecision({
        repertoireId: id,
        positionKey: AFTER_E5,
        expectedRevision: saved.repertoire.revision,
        patch: { paused: true }
      });
      practised(id, AFTER_E5, 10);
      game("1. e4 e5 2. Qh5", { daysAgo: 1 });
      await comparer().kick();
      expect(progressRepository.get(id, AFTER_E5)).toMatchObject({ lapses: 0 });
    });

    it("dates a decision from when its accepted moves were first stored", () => {
      const { id } = create("white");
      serviceNow = T0 - 5 * DAY;
      save(id, [RUY]);
      const acceptedAt = () =>
        getDb()
          .prepare(
            "SELECT accepted_at FROM repertoire_decisions WHERE repertoire_id = ? AND position_key = ?"
          )
          .get(id, AFTER_E5)?.accepted_at;
      expect(acceptedAt()).toBe(T0 - 5 * DAY);
      // A comment doesn't change the accepted set; another move of the player's does.
      serviceNow = T0 - 4 * DAY;
      save(id, [RUY], { comments: { e2e4: "Best by test" } });
      expect(acceptedAt()).toBe(T0 - 5 * DAY);
      serviceNow = T0 - 3 * DAY;
      save(id, [RUY, ["e2e4", "e7e5", "f1c4"]]);
      expect(acceptedAt()).toBe(T0 - 3 * DAY);
    });
  });

  describe("report", () => {
    it("groups slips and unprepared replies by position, with what was played and the score", async () => {
      const { id } = create("white");
      save(id, [RUY, ["e2e4", "e7e5", "g1f3", "d7d6", "d2d4"]]);
      game("1. e4 e5 2. Bc4", { daysAgo: 1, result: "1-0" });
      game("1. e4 e5 2. Bc4", { daysAgo: 3, result: "0-1" });
      game("1. e4 e5 2. d4", { daysAgo: 2, result: "1/2-1/2" });
      game("1. e4 e5 2. Nf3 f5", { daysAgo: 4, result: "1-0" });
      game("1. e4 e5 2. Nf3 f5", {
        daysAgo: 5,
        result: "1-0",
        timeControl: "600+0",
        event: "Rated Rapid game"
      });
      game("1. e4 e5 2. Nf3 Nc6 3. Bb5", { daysAgo: 6, result: "1-0" });
      game("1. d4 d5", { daysAgo: 7 });
      game("1. e4 c5", { daysAgo: 8, color: "black" });
      await comparer().kick();
      const report = insightsReport(4, T0);

      expect(report.games).toBe(8);
      expect(report.bar).toStrictEqual({
        forgot: 3,
        newReply: 2,
        stayedInBook: 1,
        otherOpenings: 2
      });
      expect(report.forgot).toHaveLength(1);
      expect(report.forgot[0]).toMatchObject({
        repertoireId: id,
        positionKey: keyAfter(["e2e4", "e7e5"]),
        games: 3,
        line: [
          { uci: "e2e4", san: "e4" },
          { uci: "e7e5", san: "e5" }
        ],
        expected: [{ uci: "g1f3", san: "Nf3" }],
        played: [
          { uci: "f1c4", san: "Bc4", games: 2 },
          { uci: "d2d4", san: "d4", games: 1 }
        ],
        score: { wins: 1, draws: 1, losses: 1, percent: 50 },
        lastSeenAt: T0 - DAY,
        study: { chapterId: expect.any(String) }
      });
      expect(report.unprepared).toMatchObject([{ reply: { san: "f5" }, games: 2, ply: 4 }]);
      expect(report.openings.youChose).toMatchObject([{ san: "d4", games: 1, color: "white" }]);
      expect(report.openings.noRepertoire).toMatchObject([{ san: "e4", games: 1, color: "black" }]);
      expect(report.timeControlCounts).toMatchObject({ blitz: 7, rapid: 1 });

      // The saved filters apply to everything: blitz only.
      insightsRepository.setFilters({
        ...insightsRepository.filters(),
        timeControls: ["blitz"]
      });
      const blitz = insightsReport(4, T0);
      expect(blitz.games).toBe(7);
      expect(blitz.unprepared[0].games).toBe(1);
      // The time-control menu still counts every time control.
      expect(blitz.timeControlCounts).toMatchObject({ blitz: 7, rapid: 1 });

      const games = insightsGamesPage(
        { page: 0, positionKey: keyAfter(["e2e4", "e7e5"]), uci: "f1c4" },
        T0
      );
      expect(games.total).toBe(2);
      expect(games.rows[0]).toMatchObject({
        outcome: "forgot",
        color: "white",
        opponent: "Rival",
        result: "win",
        issue: { ply: 3, played: "Bc4", expected: ["Nf3"] }
      });
    });

    it("scores lines up to a move, counting only games still in the repertoire there", async () => {
      const { id } = create("white");
      save(id, [RUY, ["e2e4", "e7e5", "g1f3", "d7d6", "d2d4"]]);
      game("1. e4 e5 2. Nf3 Nc6 3. Bb5", { result: "1-0" });
      game("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4", { result: "0-1" });
      game("1. e4 e5 2. Nf3 d6 3. d4", { result: "1/2-1/2" });
      // Unfinished: no points, but a game.
      game("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6", { result: "*" });
      // Left before move 2 was over: not counted.
      game("1. e4 e5 2. Bc4", { result: "1-0" });
      await comparer().kick();
      const lines = insightsReport(2, T0).scoreByLine;
      expect(lines.map((line) => [sans(line.moves), line.games])).toStrictEqual([
        ["e4 e5 Nf3 Nc6", 3],
        ["e4 e5 Nf3 d6", 1]
      ]);
      expect(lines[0]).toMatchObject({
        repertoireId: id,
        score: { wins: 1, draws: 0, losses: 1, percent: 33 },
        afterBook: null
      });
      expect(lines[0].study).not.toBeNull();
    });

    it("feeds weak-spots practice: forgotten positions by games, and the replies opponents chose", async () => {
      const { id } = create("white");
      save(id, [RUY, ["e2e4", "e7e5", "g1f3", "d7d6", "d2d4"], ["e2e4", "c7c5", "g1f3"]]);
      game("1. e4 e5 2. Nf3 Nc6 3. Bc4");
      game("1. e4 e5 2. Bc4");
      game("1. e4 e5 2. Qh5");
      game("1. e4 c5 2. Nf3 d6");
      game("1. e4 e5 2. Nf3 d6 3. d4");
      await comparer().kick();

      const spots = weakSpotPositions({}, T0);
      expect(spots.map((spot) => [spot.leadUp.length, spot.games])).toStrictEqual([
        [2, 2],
        [4, 1]
      ]);
      expect(spots[0]).toMatchObject({ repertoireId: id, expectedUcis: ["g1f3"] });
      expect(spots[0].played).toHaveLength(2);
      expect(spots[0].played).toStrictEqual(
        expect.arrayContaining([
          { uci: "f1c4", games: 1 },
          { uci: "d1h5", games: 1 }
        ])
      );
      expect(
        weakSpotPositions({ positionKey: spots[1].positionKey }, T0).map((spot) => spot.games)
      ).toStrictEqual([1]);

      const replies = replyFrequencies(id, T0);
      expect(replies.get(keyAfter(["e2e4"]))).toStrictEqual([
        { uci: "e7e5", games: 4 },
        { uci: "c7c5", games: 1 }
      ]);
      expect([...replies.get(keyAfter(["e2e4", "e7e5", "g1f3"]))!].sort(byUci)).toStrictEqual([
        { uci: "b8c6", games: 1 },
        { uci: "d7d6", games: 1 }
      ]);
    });
  });
});
