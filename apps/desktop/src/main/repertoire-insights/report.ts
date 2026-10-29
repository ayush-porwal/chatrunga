/**
 * The Insights report and games list (docs/repertoire-games-and-practice.md §5.2–§5.3), built
 * from the stored comparisons and the saved filters. Each game counts once, with the row of the
 * repertoire it followed longest.
 */
import { openingAt } from "@chaturanga/shared/chess/opening-book";
import { rootPly } from "@chaturanga/shared/chess/pgn";
import { fenAfterUci, positionFromFen } from "@chaturanga/shared/chess/position";
import { positionKey as repertoirePositionKey } from "@chaturanga/shared/chess/repertoire-position";
import { makeSanAndPlay } from "chessops/san";
import { parseUci } from "chessops/util";
import type { Color } from "@chaturanga/shared/types/chess";
import type { RatingMode } from "@chaturanga/shared/types/ratings";
import {
  INSIGHTS_GAMES_PAGE_SIZE,
  type InsightsAccount,
  type InsightsAfterBook,
  type InsightsForgotSpot,
  type InsightsGameRow,
  type InsightsGamesPage,
  type InsightsGamesQuery,
  type InsightsMove,
  type InsightsOpeningRow,
  type InsightsOpenings,
  type InsightsOutcome,
  type InsightsReport,
  type InsightsScore,
  type InsightsScoreLine,
  type InsightsStudyPlace,
  type InsightsUnpreparedReply
} from "@chaturanga/shared/types/repertoire-insights";
import { openingBook } from "../engine/opening-book";
import { positionIndexRepository } from "../repertoire/repository";
import { gameInfoOf, opponentRatingOf, passesFilters, userResult, type GameInfo } from "./games";
import { bestRecord, shownOutcome } from "./outcomes";
import { insightsRepository, type OutcomeWithGame, type StoredMove } from "./repository";

/** Score by line lists this many lines at most. */
const MAX_SCORE_LINES = 30;

/** A game as the report counts it: its facts, and the row its outcome comes from. */
type InsightsGame = {
  info: GameInfo;
  /** The row of the repertoire it followed longest (or its only row). */
  best: OutcomeWithGame;
  outcome: InsightsOutcome;
};

/** Every compared game of the user's, each with the row its outcome comes from. */
function comparedGames(repertoireId?: string): InsightsGame[] {
  const byGame = new Map<string, OutcomeWithGame[]>();
  for (const row of insightsRepository.withGames()) {
    const list = byGame.get(row.gameId);
    if (list) list.push(row);
    else byGame.set(row.gameId, [row]);
  }
  const games: InsightsGame[] = [];
  for (const rows of byGame.values()) {
    const best = bestRecord(
      rows,
      (id) =>
        rows.find((row) => row.repertoireId === id)?.repertoireCreatedAt ?? Number.MAX_SAFE_INTEGER
    );
    if (!best || (repertoireId !== undefined && best.repertoireId !== repertoireId)) continue;
    const info = gameInfoOf(best.game);
    if (info) games.push({ info, best, outcome: shownOutcome(best) });
  }
  return games;
}

/**
 * The user's compared games passing the saved filters. With `repertoireId`, only games whose
 * outcome comes from that repertoire.
 */
export function insightsGames(now: number, repertoireId?: string): InsightsGame[] {
  const filters = insightsRepository.filters();
  return comparedGames(repertoireId).filter((game) => passesFilters(game.info, filters, now));
}

/** The moves before the issue (the line to the position), or every stored move without one. */
function lineOf(row: OutcomeWithGame): StoredMove[] {
  return row.ply === null ? row.moves : row.moves.slice(0, -1);
}

/** The position after `moves` from `rootFen`; null when a move can't be played. */
function fenAfter(rootFen: string, moves: readonly { uci: string }[]): string | null {
  let fen: string | null = rootFen;
  for (const move of moves) {
    if (fen === null) return null;
    fen = fenAfterUci(fen, move.uci);
  }
  return fen;
}

/** A move's SAN in `fen` (its UCI when it can't be played there). */
function sanAt(fen: string, uci: string): string {
  try {
    const position = positionFromFen(fen);
    const move = parseUci(uci);
    return move && position.isLegal(move) ? makeSanAndPlay(position, move) : uci;
  } catch {
    return uci;
  }
}

const asMove = (move: StoredMove): InsightsMove => ({ uci: move.uci, san: move.san });

function scoreOf(games: readonly InsightsGame[]): InsightsScore {
  const score = { wins: 0, draws: 0, losses: 0, percent: 0 };
  for (const { info, best } of games) {
    const result = best.color ? userResult(info.headers, best.color) : null;
    if (result === "win") score.wins += 1;
    else if (result === "draw") score.draws += 1;
    else if (result === "loss") score.losses += 1;
  }
  // The user's points over every game: draws count half, an unfinished game nothing.
  score.percent = games.length
    ? Math.round(((score.wins + score.draws / 2) / games.length) * 100)
    : 0;
  return score;
}

function afterBookOf(games: readonly InsightsGame[]): InsightsAfterBook | null {
  const losses = games.flatMap(({ best }) =>
    best.afterBookLoss === null ? [] : [best.afterBookLoss]
  );
  if (!losses.length) return null;
  const average = losses.reduce((sum, loss) => sum + loss, 0) / losses.length;
  return { averageLoss: Math.round(average * 10) / 10, reviewedGames: losses.length };
}

/** The newest game first (a game without a date last). */
function byNewest(a: InsightsGame, b: InsightsGame): number {
  return (b.info.playedAt ?? -Infinity) - (a.info.playedAt ?? -Infinity);
}

/** The line most of `games` took to their position. */
function commonLine(games: readonly InsightsGame[]): StoredMove[] {
  const counts = new Map<string, { line: StoredMove[]; count: number }>();
  for (const { best } of games) {
    const line = lineOf(best);
    const key = line.map((move) => move.uci).join(" ");
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { line, count: 1 });
  }
  let common: { line: StoredMove[]; count: number } | null = null;
  for (const entry of counts.values()) if (!common || entry.count > common.count) common = entry;
  return common?.line ?? [];
}

/** Where Study opens a position of a repertoire: its first occurrence in chapter order. */
function studyPlace(repertoireId: string, positionKey: string): InsightsStudyPlace {
  const occurrence = positionIndexRepository.occurrences(repertoireId, positionKey).at(0);
  return occurrence ? { chapterId: occurrence.chapterId, nodeId: occurrence.nodeId } : null;
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()];
}

const mostGames = (a: { games: number }, b: { games: number }) => b.games - a.games;
/** Most games first, then the most recently seen. */
const mostGamesThenLatest = (
  a: { games: number; lastSeenAt: number | null },
  b: { games: number; lastSeenAt: number | null }
) => mostGames(a, b) || (b.lastSeenAt ?? -Infinity) - (a.lastSeenAt ?? -Infinity);

/** What a forgot row and an unprepared row share, from their games (newest first). */
function spotOf(games: InsightsGame[]) {
  games.sort(byNewest);
  const latest = games[0].best;
  const line = commonLine(games);
  const rootFen = latest.rootFen ?? "";
  const fen = fenAfter(rootFen, line) ?? rootFen;
  return {
    repertoireId: latest.repertoireId!,
    repertoireName: latest.repertoireName ?? "",
    color: latest.color!,
    positionKey: latest.positionKey!,
    fen,
    games: games.length,
    rootFen,
    line: line.map(asMove),
    score: scoreOf(games),
    lastSeenAt: games[0].info.playedAt,
    afterBook: afterBookOf(games),
    latestGameId: latest.gameId,
    ply: latest.ply!,
    study: studyPlace(latest.repertoireId!, latest.positionKey!)
  };
}

/** Positions where the user left the repertoire, grouped by repertoire and position, most games first. */
export function forgotSpots(games: readonly InsightsGame[]): InsightsForgotSpot[] {
  const forgot = games.filter((game) => game.outcome === "forgot");
  return groupBy(forgot, ({ best }) => `${best.repertoireId}\u0000${best.positionKey}`)
    .map((group): InsightsForgotSpot => {
      const spot = spotOf(group);
      const played = groupBy(group, ({ best }) => best.playedUci ?? "")
        .map((same) => ({
          uci: same[0].best.playedUci ?? "",
          san: same[0].best.moves.at(-1)?.san ?? same[0].best.playedUci ?? "",
          games: same.length
        }))
        .sort(mostGames);
      const expected = group[0].best.expectedUcis.map((uci) => ({
        uci,
        san: sanAt(spot.fen, uci)
      }));
      return { ...spot, expected, played };
    })
    .sort(mostGamesThenLatest);
}

function unpreparedReplies(games: readonly InsightsGame[]): InsightsUnpreparedReply[] {
  const replies = games.filter((game) => game.outcome === "new-reply");
  return groupBy(
    replies,
    ({ best }) => `${best.repertoireId}\u0000${best.positionKey}\u0000${best.playedUci}`
  )
    .map((group): InsightsUnpreparedReply => {
      const spot = spotOf(group);
      const reply = group[0].best.moves.at(-1);
      return {
        ...spot,
        reply: reply ? asMove(reply) : { uci: group[0].best.playedUci ?? "", san: "" }
      };
    })
    .sort(mostGamesThenLatest);
}

/** Which openings column a game outside the repertoire goes in, and the move it is listed by. */
function openingEntry(
  game: InsightsGame
): { column: keyof InsightsOpenings; move: StoredMove; before: StoredMove[] } | null {
  const { best } = game;
  if (best.outcome === "no-repertoire") {
    const move = best.moves.at(0);
    return move ? { column: "noRepertoire", move, before: [] } : null;
  }
  const move = best.moves.at(-1);
  if (!move || best.ply === null || !best.color) return null;
  // Whose move it was, from the ply: odd plies are White's.
  const mover: Color = best.ply % 2 === 1 ? "white" : "black";
  return {
    column: mover === best.color ? "youChose" : "opponentsChose",
    move,
    before: best.moves.slice(0, -1)
  };
}

function openingsOf(games: readonly InsightsGame[]): InsightsOpenings {
  const openings: InsightsOpenings = { opponentsChose: [], youChose: [], noRepertoire: [] };
  const entries = games
    .filter((game) => game.outcome === "not-covered" || game.outcome === "no-repertoire")
    .flatMap((game) => {
      const entry = openingEntry(game);
      return entry ? [{ game, ...entry }] : [];
    });
  for (const group of groupBy(
    entries,
    (entry) =>
      `${entry.column}\u0000${entry.game.best.color}\u0000${entry.before.map((move) => move.uci).join(" ")} ${entry.move.uci}`
  )) {
    const { column, move, before, game } = group[0];
    const fen = fenAfter(game.best.rootFen ?? "", [...before, move]);
    const row: InsightsOpeningRow = {
      ...asMove(move),
      opening: fen ? (openingAt(openingBook(), fen)?.name ?? null) : null,
      games: group.length,
      color: game.best.color!
    };
    openings[column].push(row);
  }
  for (const column of Object.values(openings)) column.sort(mostGames);
  return openings;
}

/**
 * Games grouped by their moves up to move `lineMove`, counting only those still in the repertoire
 * there: the issue (if any) came later, or the game ended in book after it.
 */
function scoreByLine(games: readonly InsightsGame[], lineMove: number): InsightsScoreLine[] {
  const lastPly = lineMove * 2;
  const inBook = games.flatMap((game) => {
    const { best } = game;
    if (!best.repertoireId || !best.color) return [];
    if (!["forgot", "new-reply", "ended-in-book", "in-book"].includes(game.outcome)) return [];
    const count = lastPly - rootPly(best.rootFen ?? "");
    if (count <= 0) return [];
    if (best.ply !== null ? best.ply <= lastPly : best.moves.length < count) return [];
    return [{ game, line: best.moves.slice(0, count) }];
  });
  return groupBy(
    inBook,
    ({ game, line }) => `${game.best.repertoireId}\u0000${line.map((move) => move.uci).join(" ")}`
  )
    .map((group): InsightsScoreLine => {
      const { game, line } = group[0];
      const { best } = game;
      const members = group.map((entry) => entry.game);
      const after = best.moves.at(line.length);
      const fen = after ? null : fenAfter(best.rootFen ?? "", line);
      const key = after?.key ?? (fen ? positionKeyOf(fen) : null);
      return {
        repertoireId: best.repertoireId!,
        color: best.color!,
        rootFen: best.rootFen ?? "",
        moves: line.map(asMove),
        games: members.length,
        score: scoreOf(members),
        afterBook: afterBookOf(members),
        study: key ? studyPlace(best.repertoireId!, key) : null
      };
    })
    .sort(mostGames)
    .slice(0, MAX_SCORE_LINES);
}

function positionKeyOf(fen: string): string | null {
  try {
    return repertoirePositionKey(fen);
  } catch {
    return null;
  }
}

function tally<K extends string>(
  initial: Record<K, number>,
  values: readonly K[]
): Record<K, number> {
  const counts = { ...initial };
  for (const value of values) counts[value] += 1;
  return counts;
}

/** The report under the saved filters, with score by line at move `lineMove`. */
export function insightsReport(lineMove: number, now: number = Date.now()): InsightsReport {
  const filters = insightsRepository.filters();
  const all = comparedGames();
  const games = all.filter((game) => passesFilters(game.info, filters, now));
  const compared = games.filter((game) => game.outcome !== "no-user-side");
  const count = (...outcomes: InsightsOutcome[]) =>
    compared.filter((game) => outcomes.includes(game.outcome)).length;
  const counted = (ignore: "timeControls" | "accounts") =>
    all.filter((game) => passesFilters(game.info, filters, now, ignore));
  return {
    games: compared.length,
    noUserSide: games.length - compared.length,
    bar: {
      forgot: count("forgot"),
      newReply: count("new-reply"),
      stayedInBook: count("in-book", "ended-in-book"),
      otherOpenings: count("not-covered", "no-repertoire")
    },
    forgot: forgotSpots(compared),
    unprepared: unpreparedReplies(compared),
    openings: openingsOf(compared),
    scoreByLine: scoreByLine(compared, lineMove),
    timeControlCounts: tally<RatingMode>(
      { bullet: 0, blitz: 0, rapid: 0, classical: 0, correspondence: 0 },
      counted("timeControls").map((game) => game.info.timeControl)
    ),
    accountCounts: tally<InsightsAccount>(
      { lichess: 0, chesscom: 0, imported: 0 },
      counted("accounts").map((game) => game.info.account)
    )
  };
}

function matchesQuery(game: InsightsGame, query: InsightsGamesQuery): boolean {
  const { best } = game;
  if (query.color && best.color !== query.color) return false;
  if (query.repertoireId && best.repertoireId !== query.repertoireId) return false;
  if (query.outcomes?.length && !query.outcomes.includes(game.outcome)) return false;
  if (query.upToMove && (best.ply === null || best.ply > query.upToMove * 2)) return false;
  if (query.positionKey && best.positionKey !== query.positionKey) return false;
  return !query.uci || best.playedUci === query.uci;
}

function gameRow(game: InsightsGame): InsightsGameRow {
  const { info, best } = game;
  const color = best.color;
  const issue =
    best.ply !== null && best.moves.length
      ? {
          ply: best.ply,
          played: best.moves.at(-1)?.san ?? null,
          expected:
            best.outcome === "forgot"
              ? best.expectedUcis.map((uci) =>
                  sanAt(fenAfter(best.rootFen ?? "", lineOf(best)) ?? "", uci)
                )
              : []
        }
      : null;
  return {
    gameId: best.gameId,
    playedAt: info.playedAt,
    account: info.account,
    color,
    opponent: color ? ((color === "white" ? info.black : info.white) ?? null) : null,
    opponentRating: color ? opponentRatingOf(info.headers, color) : null,
    result: color ? userResult(info.headers, color) : null,
    timeControl: info.timeControl,
    opening: info.headers.opening ?? null,
    outcome: game.outcome,
    issue,
    repertoireId: best.repertoireId,
    repertoireName: best.repertoireName
  };
}

/** A page of the games list (newest first) under the saved filters and `query`'s own. */
export function insightsGamesPage(
  query: InsightsGamesQuery,
  now: number = Date.now()
): InsightsGamesPage {
  const games = insightsGames(now)
    .filter((game) => matchesQuery(game, query))
    .sort(byNewest);
  const start = query.page * INSIGHTS_GAMES_PAGE_SIZE;
  return {
    rows: games.slice(start, start + INSIGHTS_GAMES_PAGE_SIZE).map(gameRow),
    total: games.length,
    page: query.page
  };
}
