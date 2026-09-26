import type { Chess } from "chessops/chess";
import { attacks } from "chessops/attacks";
import { makeFen } from "chessops/fen";
import { makeSanAndPlay } from "chessops/san";
import type { SquareSet } from "chessops/squareSet";
import { makeSquare, opposite, parseUci, squareRank } from "chessops/util";
import type { Color, NormalMove, Role, Square } from "chessops/types";
import type { IdeaFactsPayload } from "../schemas/review-insight";
import { positionFromFen } from "./position";
import {
  PIECE_POINTS,
  attackersOf,
  describeBoard,
  exchangeGain,
  pieceOn,
  pieceWeight,
  pinnerOf,
  positionSnapshot,
  sideName,
  snapshotChanges,
  type PositionSnapshot
} from "./position-features";

/**
 * "Idea facts" for the review coach: what a move actually does on the board.
 *
 * The engine says WHICH move is best; these facts say WHY in chess terms —
 * what the moved piece now attacks, what it stopped guarding, which pieces are
 * left loose, which lines opened, what the opponent's best reply exploits and
 * what the better move threatens. Every statement is computed from legal
 * positions (chessops), so the coach can be required to stay inside them.
 */

const MAX_FACTS = 7;

export type IdeaFacts = IdeaFactsPayload;

type Played = {
  before: Chess;
  after: Chess;
  move: NormalMove;
  san: string;
  mover: Color;
  role: Role;
  captured?: Role;
};

/** A played move plus the derived values every fact helper needs. */
type MoveContext = Played & {
  enemy: Color;
  /** Where the moved piece stands after the move (castling moves the king to the g/c-file). */
  to: Square;
  castle: boolean;
};

/** Role taken by `move`, if any (en passant included; chessops castling is king-takes-rook, not a capture). */
function capturedRole(pos: Chess, move: NormalMove): Role | undefined {
  const target = pos.board.get(move.to);
  if (target) return target.color === pos.board.getColor(move.from) ? undefined : target.role;
  return pos.board.getRole(move.from) === "pawn" && pos.epSquare === move.to ? "pawn" : undefined;
}

function play(fen: string, uci: string): Played | null {
  try {
    const before = positionFromFen(fen);
    const move = parseUci(uci);
    if (!move || !("from" in move) || !before.isLegal(move)) return null;
    const piece = before.board.get(move.from);
    if (!piece) return null;
    const captured = capturedRole(before, move);
    const after = before.clone();
    const san = makeSanAndPlay(after, move);
    return { before, after, move, san, mover: piece.color, role: piece.role, captured };
  } catch {
    return null;
  }
}

function isCastle(played: Played): boolean {
  return played.role === "king" && played.before.board.getColor(played.move.to) === played.mover;
}

function landingSquare(played: Played): Square {
  if (!isCastle(played)) return played.move.to;
  return played.after.board.kingOf(played.mover) ?? played.move.to;
}

function contextOf(played: Played): MoveContext {
  return {
    ...played,
    enemy: opposite(played.mover),
    to: landingSquare(played),
    castle: isCastle(played)
  };
}

function pieceAttacks(pos: Chess, square: Square): SquareSet | null {
  const piece = pos.board.get(square);
  return piece ? attacks(piece, square, pos.board.occupied) : null;
}

function isSlider(role: Role): boolean {
  return role === "bishop" || role === "rook" || role === "queen";
}

function defenceNote(pos: Chess, square: Square, owner: Color): string {
  const defenders = attackersOf(pos, square, owner).size();
  return defenders ? `defended ${defenders === 1 ? "once" : `${defenders} times`}` : "undefended";
}

function looseNote(pos: Chess, square: Square): string {
  const owner = pos.board.getColor(square);
  if (!owner) return "";
  const attackers = Array.from(attackersOf(pos, square, opposite(owner)), (sq) => pieceOn(pos, sq));
  const pinner = pinnerOf(pos, square);
  const pin = pinner !== undefined ? `pinned to the king by the ${pieceOn(pos, pinner)}; ` : "";
  return `${pin}attacked by the ${attackers.slice(0, 2).join(" and the ")}, ${defenceNote(pos, square, owner)}`;
}

/** Pieces of `victim` that the other side wins material against by capturing (static exchange). */
function loosePieces(pos: Chess, victim: Color): Square[] {
  return Array.from(pos.board[victim]).filter(
    (sq) => pos.board.getRole(sq) !== "king" && exchangeGain(pos, sq) > 0
  );
}

function pieceList(pos: Chess, squares: readonly Square[], limit: number): string {
  return squares
    .slice(0, limit)
    .map((sq) => pieceOn(pos, sq))
    .join(" and the ");
}

/** Castling, capture, promotion, check. */
function actionFacts(m: MoveContext): string[] {
  const facts: string[] = [];
  if (m.castle) {
    facts.push(
      `castles ${m.to % 8 >= 4 ? "short" : "long"}, bringing the king to ${makeSquare(m.to)} and the rook into play`
    );
  }
  if (m.captured) {
    const note = defenceNote(m.before, m.move.to, m.enemy);
    facts.push(`captures the ${m.captured} on ${makeSquare(m.move.to)} (it was ${note})`);
  }
  if (m.move.promotion) facts.push(`promotes the pawn to a ${m.move.promotion}`);
  if (m.after.isCheck()) facts.push("gives check");
  return facts;
}

/** Safety of the moved piece where it landed, escaping an attack, and guarding pieces under fire. */
function safetyFacts(m: MoveContext): string[] {
  const { before, after, move, role, to } = m;
  const facts: string[] = [];
  const movesPiece = !m.castle && role !== "king";

  // A capture that is merely recaptured is a trade, not a blunder.
  const landingGain = movesPiece ? exchangeGain(after, to) : 0;
  const capturedPoints = m.captured ? PIECE_POINTS[m.captured] : 0;
  if (landingGain > capturedPoints) {
    facts.push(
      `puts the ${role} on ${makeSquare(to)} where it can be won: ${looseNote(after, to)}`
    );
  } else if (landingGain > 0 && m.captured) {
    facts.push(
      `trades on ${makeSquare(to)}: the ${role} can be recaptured (${looseNote(after, to)})`
    );
  }

  if (movesPiece && exchangeGain(before, move.from) > 0 && exchangeGain(after, to) <= 0) {
    const threat = Array.from(attackersOf(before, move.from, m.enemy), (sq) =>
      pieceOn(before, sq)
    )[0];
    facts.push(`moves the ${role} out of danger${threat ? ` from the ${threat}` : ""}`);
  }
  const guards = pieceAttacks(after, to);
  if (guards) {
    const rescued = Array.from(guards.intersect(after.board[m.mover])).filter(
      (sq) => sq !== to && exchangeGain(before, sq) > 0 && exchangeGain(after, sq) <= 0
    );
    if (rescued.length)
      facts.push(`now guards the ${pieceList(after, rescued, 2)}, which was under attack`);
  }
  return facts;
}

/** New targets of the moved piece: a fork, or the meaningful new attacks. */
function targetFacts(m: MoveContext): { facts: string[]; targets: Square[] } {
  const { before, after, move, role, to, enemy } = m;
  const nowHits = pieceAttacks(after, to);
  if (!nowHits) return { facts: [], targets: [] };
  const usedToHit = m.castle ? null : pieceAttacks(before, move.from);
  const enemies = Array.from(nowHits.intersect(after.board[enemy]));
  const undefended = (sq: Square) => attackersOf(after, sq, enemy).isEmpty();

  // Only attacks that matter: winnable, undefended, or on a more valuable piece.
  const targets = enemies.filter((sq) => {
    const targetRole = after.board.getRole(sq);
    if (!targetRole || targetRole === "king" || usedToHit?.has(sq)) return false;
    return (
      exchangeGain(after, sq) > 0 || undefended(sq) || pieceWeight(targetRole) > pieceWeight(role)
    );
  });
  const forkTargets = enemies.filter((sq) => {
    const r = after.board.getRole(sq);
    return (
      r !== undefined && (r === "king" || pieceWeight(r) > pieceWeight(role) || undefended(sq))
    );
  });

  // A "fork" by a piece that can simply be taken is not a fork worth mentioning.
  if (forkTargets.length >= 2 && exchangeGain(after, to) <= 0) {
    return { facts: [`forks the ${pieceList(after, forkTargets, 3)}`], targets };
  }
  if (!targets.length) return { facts: [], targets };
  const described = targets
    .slice(0, 3)
    .map((sq) => `${pieceOn(after, sq)} (${defenceNote(after, sq, enemy)})`)
    .join(", ");
  return { facts: [`attacks the ${described}`], targets };
}

/** Other sliders (either side) that see further because the piece left its square. */
function discoveredLineFacts(m: MoveContext): string[] {
  const { before, after, mover, enemy, to } = m;
  const facts: string[] = [];
  for (const sq of after.board.occupied) {
    if (sq === to) continue;
    const piece = after.board.get(sq);
    if (!piece || !isSlider(piece.role) || before.board.get(sq)?.role !== piece.role) continue;
    const was = pieceAttacks(before, sq);
    const now = pieceAttacks(after, sq);
    if (!was || !now) continue;
    const gained = now.diff(was);
    if (gained.isEmpty()) continue;
    const hit = Array.from(gained.intersect(after.board[opposite(piece.color)])).filter(
      (target) => after.board.getRole(target) !== undefined
    );
    if (piece.color === mover && hit.length) {
      facts.push(
        `uncovers the ${pieceOn(after, sq)}, which now attacks the ${pieceList(after, hit, 2)}`
      );
    } else if (piece.color === enemy && hit.length) {
      facts.push(
        `opens a line for the opponent's ${pieceOn(after, sq)}, which now hits the ${pieceList(after, hit, 2)}`
      );
    } else if (piece.color === mover && gained.size() >= 3) {
      const enemyHalf = Array.from(gained).filter((g) =>
        mover === "white" ? squareRank(g) >= 4 : squareRank(g) <= 3
      );
      if (enemyHalf.length >= 2)
        facts.push(`opens the line for the ${pieceOn(after, sq)} toward the opponent's side`);
    }
  }
  return facts;
}

/** Defensive duties given up (by moving away, or by blocking another defender), where it now matters. */
function abandonedDutyFacts(m: MoveContext): string[] {
  const { before, after, move, mover, enemy, role, to } = m;
  const facts: string[] = [];
  for (const sq of after.board[mover]) {
    if (sq === to) continue;
    const r = after.board.getRole(sq);
    if (!r || r === "king" || r === "pawn") continue;
    if (before.board.getColor(sq) !== mover || before.board.getRole(sq) !== r) continue;
    const defendersAfter = attackersOf(after, sq, mover);
    const lost = Array.from(attackersOf(before, sq, mover)).filter((d) =>
      d === move.from ? !defendersAfter.has(to) : !defendersAfter.has(d)
    );
    if (!lost.length) continue;
    const attacked = attackersOf(after, sq, enemy).nonEmpty();
    // Worth saying only when the piece can now be won, or sits undefended.
    if (attacked ? exchangeGain(after, sq) <= 0 : defendersAfter.nonEmpty()) continue;
    const who = lost.includes(move.from)
      ? `the ${role} used to guard it`
      : `it blocks the ${pieceOn(before, lost[0] as Square)}`;
    const status = attacked ? looseNote(after, sq) : "now undefended";
    facts.push(`stops protecting the ${pieceOn(after, sq)} (${who}; ${status})`);
  }
  return facts.slice(0, 2);
}

/** Own pieces left loose, and new threats against enemy pieces not already named as targets. */
function looseFacts(
  m: MoveContext,
  abandoned: readonly string[],
  targets: readonly Square[]
): string[] {
  const { before, after, mover, enemy, to } = m;
  const facts: string[] = [];
  const wasLoose = new Set(loosePieces(before, mover));
  for (const sq of loosePieces(after, mover)
    .filter((s) => s !== to)
    .slice(0, 2)) {
    if (abandoned.some((text) => text.includes(pieceOn(after, sq)))) continue;
    facts.push(
      wasLoose.has(sq)
        ? `does nothing for the ${pieceOn(after, sq)}, which stays loose (${looseNote(after, sq)})`
        : `leaves the ${pieceOn(after, sq)} loose (${looseNote(after, sq)})`
    );
  }
  const enemyLooseBefore = new Set(loosePieces(before, enemy));
  const threats = loosePieces(after, enemy).filter(
    (sq) => !enemyLooseBefore.has(sq) && !targets.includes(sq)
  );
  for (const sq of threats.slice(0, 2)) {
    facts.push(`creates a threat against the ${pieceOn(after, sq)} (${looseNote(after, sq)})`);
  }
  return facts;
}

/** Quiet purposes a player would recognise: development, rooks on open files. */
function quietFacts(m: MoveContext): string[] {
  if (m.captured || m.castle) return [];
  const { move, role, to } = m;
  const facts: string[] = [];
  if (
    (role === "knight" || role === "bishop") &&
    squareRank(move.from) === (m.mover === "white" ? 0 : 7)
  ) {
    facts.push(`develops the ${role} from ${makeSquare(move.from)}`);
  }
  if (role === "rook") {
    const file = to % 8;
    const pawnsOnFile = Array.from(m.after.board.pawn).some((sq) => sq % 8 === file);
    if (!pawnsOnFile) facts.push(`puts the rook on the open ${"abcdefgh"[file]}-file`);
  }
  return facts;
}

/** The core description of one move: what it does, gives up and creates. */
function moveFacts(played: Played): string[] {
  const m = contextOf(played);
  const targets = targetFacts(m);
  const abandoned = abandonedDutyFacts(m);
  return [
    ...actionFacts(m),
    ...safetyFacts(m),
    ...targets.facts,
    ...discoveredLineFacts(m),
    ...abandoned,
    ...looseFacts(m, abandoned, targets.targets),
    ...quietFacts(m)
  ].slice(0, MAX_FACTS);
}

const COUNT_WORD = ["", "a", "two", "three", "four", "five", "six", "seven", "eight"];

function materialList(roles: readonly Role[]): string {
  if (!roles.length) return "nothing";
  const counts = new Map<Role, number>();
  for (const r of roles) counts.set(r, (counts.get(r) ?? 0) + 1);
  return Array.from(counts, ([r, n]) => `${COUNT_WORD[n] ?? n} ${r}${n > 1 ? "s" : ""}`).join(
    " and "
  );
}

/** Material swing over the first plies of a line, e.g. "over 4 plies Black wins a rook for a knight". */
export function lineOutcome(fen: string, pv: readonly string[], maxPlies = 8): string | null {
  try {
    const pos = positionFromFen(fen);
    const won: Record<Color, Role[]> = { white: [], black: [] };
    let plies = 0;
    for (const uci of pv.slice(0, maxPlies)) {
      const move = parseUci(uci);
      if (!move || !("from" in move) || !pos.isLegal(move)) break;
      const captured = capturedRole(pos, move);
      if (captured) won[pos.turn].push(captured);
      pos.play(move);
      plies += 1;
      if (pos.isEnd()) break;
    }
    if (!plies) return null;
    const mate = pos.isCheckmate()
      ? `, ending with ${sideName(opposite(pos.turn))} delivering checkmate`
      : "";
    if (!won.white.length && !won.black.length)
      return mate ? `the line${mate.replace(/^,/, "")}` : null;
    const points = (roles: Role[]) => roles.reduce((sum, r) => sum + PIECE_POINTS[r], 0);
    const net = points(won.white) - points(won.black);
    const span = `${plies} ${plies === 1 ? "ply" : "plies"}`;
    const simple = won.white.length + won.black.length <= 3;
    if (net === 0) {
      return simple
        ? `over ${span} the material trades evenly (${materialList(won.white)} for ${materialList(won.black)})${mate}`
        : `over ${span} the trades leave material level${mate}`;
    }
    const winner: Color = net > 0 ? "white" : "black";
    const margin = Math.abs(net);
    return simple
      ? `over ${span} ${sideName(winner)} wins ${materialList(won[winner])} for ${materialList(won[opposite(winner)])}${mate}`
      : `over ${span} of trades ${sideName(winner)} comes out ${margin} point${margin === 1 ? "" : "s"} of material ahead${mate}`;
  } catch {
    return null;
  }
}

/** What the opponent's best reply exploits in the played move. */
function replyFacts(played: Played, reply: Played): string[] {
  const facts: string[] = [];
  const to = landingSquare(played);
  const target = reply.move.to;
  if (reply.captured) {
    if (target === to) {
      facts.push(`captures the ${played.role} that ${played.san} just put on ${makeSquare(to)}`);
    } else {
      const defendersBefore = attackersOf(played.before, target, played.mover);
      const defendersAfter = attackersOf(played.after, target, played.mover);
      const movedDefender = defendersBefore.has(played.move.from) && !defendersAfter.has(to);
      const piece = `the ${reply.captured} on ${makeSquare(target)}`;
      if (movedDefender) facts.push(`takes ${piece}, which ${played.san} stopped defending`);
      else if (defendersAfter.isEmpty()) facts.push(`takes ${piece}, which was left undefended`);
      else facts.push(`takes ${piece}`);
    }
  }
  const own = moveFacts(reply).filter(
    (fact) => !fact.startsWith("captures the") && !fact.startsWith("does nothing for")
  );
  // Attacks on the piece that just moved (unless a fork already says so).
  const hits = pieceAttacks(reply.after, landingSquare(reply));
  const movedName = `${played.role} on ${makeSquare(to)}`;
  const forkMentions = own.some((fact) => fact.startsWith("forks") && fact.includes(movedName));
  if (
    !reply.captured &&
    !forkMentions &&
    hits?.has(to) &&
    reply.after.board.getColor(to) === played.mover
  ) {
    facts.push(`attacks the ${played.role} that just moved to ${makeSquare(to)}`);
  }
  facts.push(...own);
  return facts.slice(0, MAX_FACTS);
}

/** The next forcing move (capture or check) of the line after `move`, e.g. "sets up Nxa8 after Kd7, capturing the rook on a8". */
function lineThreat(move: Played, line: readonly string[]): string | null {
  const [, replyUci, nextUci] = line;
  if (!replyUci || !nextUci) return null;
  try {
    const pos = move.after.clone();
    const reply = parseUci(replyUci);
    if (!reply || !pos.isLegal(reply)) return null;
    const replySan = makeSanAndPlay(pos, reply);
    const followUp = parseUci(nextUci);
    if (!followUp || !("from" in followUp) || !pos.isLegal(followUp)) return null;
    const captured =
      pos.board.getColor(followUp.to) === opposite(move.mover)
        ? pos.board.getRole(followUp.to)
        : undefined;
    const probe = pos.clone();
    const san = makeSanAndPlay(probe, followUp);
    if (captured)
      return `sets up ${san} after ${replySan}, capturing the ${captured} on ${makeSquare(followUp.to)}`;
    return probe.isCheck() ? `sets up ${san} after ${replySan}, with check` : null;
  } catch {
    // A malformed PV only drops this optional fact.
    return null;
  }
}

export type IdeaFactsInput = {
  fenBefore: string;
  playedUci: string;
  bestUci?: string | null;
  bestLine?: readonly string[];
  /** Opponent's best line after the played move (UCI from fenAfter). */
  replyLine?: readonly string[];
  /** Include development info in the snapshots. */
  early?: boolean;
};

/**
 * The threat and material outcome of the engine line starting with `move`.
 * The best move lists its threat first; when the played move was best, the
 * "main line" outcome comes first (this order decides what survives MAX_FACTS).
 */
function lineFacts(
  move: Played,
  fenBefore: string,
  line: readonly string[] | undefined,
  label: "best line" | "main line"
): string[] {
  if (!line?.length) return [];
  const threat = lineThreat(move, line);
  const outcome = lineOutcome(fenBefore, line);
  const outcomeFact = outcome ? `${label}: ${outcome}` : null;
  const ordered = label === "best line" ? [threat, outcomeFact] : [outcomeFact, threat];
  return ordered.filter((fact): fact is string => fact !== null);
}

/**
 * Build the idea facts for one reviewed move. Returns null only when the move
 * cannot be replayed from `fenBefore`.
 */
export function buildIdeaFacts(input: IdeaFactsInput): IdeaFacts | null {
  const played = play(input.fenBefore, input.playedUci);
  if (!played) return null;
  const board = describeBoard(input.fenBefore);
  if (!board) return null;
  const fenAfter = fenOf(played.after);
  const playedIsBest = !input.bestUci || input.bestUci === input.playedUci;

  const result: IdeaFacts = {
    board,
    played: { san: played.san, facts: moveFacts(played) }
  };

  if (!playedIsBest) {
    const best = play(input.fenBefore, input.bestUci as string);
    if (best) {
      const facts = [
        ...moveFacts(best),
        ...lineFacts(best, input.fenBefore, input.bestLine, "best line")
      ];
      result.best = { san: best.san, facts: facts.slice(0, MAX_FACTS) };
    }
  } else {
    const facts = [
      ...result.played.facts,
      ...lineFacts(played, input.fenBefore, input.bestLine, "main line")
    ];
    result.played.facts = facts.slice(0, MAX_FACTS);
  }

  const replyUci = input.replyLine?.[0];
  if (replyUci && input.bestUci !== input.playedUci) {
    const reply = play(fenAfter, replyUci);
    if (reply) {
      const facts = replyFacts(played, reply);
      const outcome = lineOutcome(fenAfter, input.replyLine ?? []);
      if (outcome) facts.push(`reply line: ${outcome}`);
      result.reply = { san: reply.san, facts: facts.slice(0, MAX_FACTS) };
    }
  }

  const before = positionSnapshot(input.fenBefore, Boolean(input.early));
  const after = positionSnapshot(fenAfter, Boolean(input.early));
  if (before && after) {
    const changes = snapshotChanges(before, after);
    // "before" carries only what differs from "after", to keep the payload small.
    const beforeDiff = Object.fromEntries(
      Object.entries(before.snapshot).filter(
        ([key, value]) => after.snapshot[key as keyof PositionSnapshot] !== value
      )
    ) as Partial<PositionSnapshot>;
    result.position = {
      before: beforeDiff,
      after: after.snapshot,
      ...(changes.length ? { changes } : {})
    };
  }
  return result;
}

function fenOf(pos: Chess): string {
  return makeFen(pos.toSetup());
}
