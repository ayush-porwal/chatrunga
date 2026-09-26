import type { Chess } from "chessops/chess";
import { attacks } from "chessops/attacks";
import { makeSquare, opposite } from "chessops/util";
import type { Color, Piece, Role, Square } from "chessops/types";
import { positionFromFen } from "./position";
import type { TacticalFact } from "../schemas/tactical-fact";
import { exchangeGain } from "./position-features";

/**
 * Tactics engine — detects structured motifs over `chessops` attack maps.
 *
 * Four detectors:
 *   - hanging        piece with more attackers than defenders, exchange-net negative
 *   - fork           mover's piece attacks 2+ targets where at least one is higher
 *                    value OR undefended
 *   - pin            ray from attacker through pinned through king (absolute) or
 *                    higher-value piece (relative)
 *   - skewer         ray from attacker through front (higher-value) through behind
 *
 * Each detector runs over the POSITION AFTER the player's move (fenAfter).
 * The motifs describe what's TRUE after the move was played — used by the coach
 * to explain "why this move was good/bad."
 */

const PIECE_VALUE: Record<Role, number> = {
  pawn: 100,
  knight: 320,
  bishop: 330,
  rook: 500,
  queen: 900,
  king: 100000
};

export type AnalyzeTacticsOptions = {
  /**
   * Position before the move. When given, motifs that already existed there
   * (e.g. an old pin elsewhere on the board) are dropped so only what the move
   * created or left behind is reported.
   */
  fenBefore?: string;
};

export function analyzeTacticsForPosition(
  fen: string,
  mover: Color,
  options: AnalyzeTacticsOptions = {}
): TacticalFact[] {
  const facts = detectAll(fen, mover);
  if (!options.fenBefore) return facts;
  let existing: Set<string>;
  try {
    existing = new Set(detectAll(options.fenBefore, mover).map(factKey));
  } catch {
    return facts;
  }
  return facts.filter((fact) => !existing.has(factKey(fact)));
}

function detectAll(fen: string, mover: Color): TacticalFact[] {
  const pos = positionFromFen(fen);
  // The mover just moved: look for THEIR pieces left hanging (the opponent's
  // threats came alive after this move), and for the forks / pins / skewers
  // THEIR pieces now create.
  const pins: TacticalFact[] = [];
  const skewers: TacticalFact[] = [];
  for (const line of xRayLines(pos, mover)) {
    const pin = pinOn(pos, line);
    if (pin) pins.push(pin);
    const skewer = skewerOn(pos, line);
    if (skewer) skewers.push(skewer);
  }
  return [...detectHanging(pos, mover), ...detectForks(pos, mover), ...pins, ...skewers];
}

function factKey(fact: TacticalFact): string {
  switch (fact.kind) {
    case "hanging":
      return `hanging:${fact.piece.role}@${fact.piece.square}`;
    case "fork":
      return `fork:${fact.attacker.square}:${fact.targets
        .map((t) => t.square)
        .sort()
        .join(",")}`;
    case "pin":
      return `pin:${fact.pinner.square}:${fact.pinned.square}:${fact.behind.square}`;
    case "skewer":
      return `skewer:${fact.attacker.square}:${fact.front.square}:${fact.behind.square}`;
  }
}

/**
 * A piece of `victim` color is hanging when the opponent wins material by
 * capturing it: a proper static exchange (cheapest attacker first, cheapest
 * defender recaptures, either side may stop) with a positive result.
 */
function detectHanging(pos: Chess, victim: Color): TacticalFact[] {
  const facts: TacticalFact[] = [];
  const attackerColor = opposite(victim);

  for (const square of pos.board[victim]) {
    const piece = pos.board.get(square);
    if (!piece) continue;
    if (piece.role === "king") continue; // king "hanging" = check; handled elsewhere

    const attackers = pos.kingAttackers(square, attackerColor, pos.board.occupied);
    if (attackers.isEmpty()) continue;
    if (exchangeGain(pos, square) <= 0) continue;
    const defenders = pos.kingAttackers(square, victim, pos.board.occupied);

    facts.push({
      kind: "hanging",
      piece: { role: piece.role, square: makeSquare(square) },
      attackedBy: Array.from(attackers, makeSquare),
      defendedBy: Array.from(defenders, makeSquare)
    });
  }
  return facts;
}

/**
 * Fork: the mover's piece attacks 2+ enemy pieces where at least one is
 * higher-value OR undefended.
 *
 * We scan the mover's pieces and ask "which of your pieces attack 2+ enemy pieces?"
 * We pick the strongest fork: prefer KQ over QR, prefer with-undefended over all-defended.
 */
function detectForks(pos: Chess, mover: Color): TacticalFact[] {
  const facts: TacticalFact[] = [];
  const enemyColor = opposite(mover);

  for (const square of pos.board[mover]) {
    const piece = pos.board.get(square);
    if (!piece) continue;

    const attackSet = attacks(piece, square, pos.board.occupied);
    const enemyHits = attackSet.intersect(pos.board[enemyColor]);
    if (enemyHits.size() < 2) continue;
    // A forking piece that can simply be captured for profit is not a real fork.
    if (piece.role !== "king" && exchangeGain(pos, square) > 0) continue;

    const targets: { role: Role; square: string; value: number }[] = [];
    let qualifies = false;
    for (const hitSq of enemyHits) {
      const hitPiece = pos.board.get(hitSq);
      if (!hitPiece) continue;
      const undefended = pos.kingAttackers(hitSq, enemyColor, pos.board.occupied).isEmpty();
      const isHigherValue = PIECE_VALUE[hitPiece.role] > PIECE_VALUE[piece.role];
      if (undefended || isHigherValue) qualifies = true;
      targets.push({
        role: hitPiece.role,
        square: makeSquare(hitSq),
        value: PIECE_VALUE[hitPiece.role]
      });
    }
    if (!qualifies) continue;
    // Sort targets by value descending so the prose reads "...forks the queen and rook"
    // not "...forks the rook and queen."
    targets.sort((a, b) => b.value - a.value);

    facts.push({
      kind: "fork",
      attacker: { role: piece.role, square: makeSquare(square) },
      targets
    });
  }
  return facts;
}

type XRayLine = {
  attackerSq: Square;
  attacker: Piece;
  frontSq: Square;
  front: Piece;
  behindSq: Square;
  behind: Piece;
};

/**
 * Every line where a slider of `mover` attacks an enemy piece (`front`) with
 * another enemy piece directly behind it. Removing the front piece only
 * extends that one ray, so there is at most one `behind` per front.
 */
function* xRayLines(pos: Chess, mover: Color): Generator<XRayLine> {
  const enemies = pos.board[opposite(mover)];
  for (const attackerSq of pos.board[mover]) {
    const attacker = pos.board.get(attackerSq);
    if (!attacker || !isSlider(attacker.role)) continue;
    const direct = attacks(attacker, attackerSq, pos.board.occupied);
    for (const frontSq of direct.intersect(enemies)) {
      const front = pos.board.get(frontSq);
      if (!front) continue;
      const beyond = attacks(attacker, attackerSq, pos.board.occupied.without(frontSq))
        .diff(direct)
        .intersect(enemies);
      for (const behindSq of beyond) {
        const behind = pos.board.get(behindSq);
        if (behind) yield { attackerSq, attacker, frontSq, front, behindSq, behind };
      }
    }
  }
}

/**
 * Pin: the piece behind is worth more than the front (pinned) piece. With the
 * king behind the pin is absolute, otherwise relative.
 */
function pinOn(pos: Chess, line: XRayLine): TacticalFact | null {
  const { attackerSq, attacker, frontSq, front, behindSq, behind } = line;
  if (PIECE_VALUE[behind.role] <= PIECE_VALUE[front.role]) return null;
  if (!isMeaningfulPin(pos, attackerSq, attacker, frontSq, front, behind)) return null;
  return {
    kind: "pin",
    pinned: { role: front.role, square: makeSquare(frontSq) },
    pinner: { role: attacker.role, square: makeSquare(attackerSq) },
    behind: { role: behind.role, square: makeSquare(behindSq) }
  };
}

/**
 * Skewer: the front piece is worth more than the one behind; when it moves
 * away, the piece behind is captured.
 */
function skewerOn(pos: Chess, line: XRayLine): TacticalFact | null {
  const { attackerSq, attacker, frontSq, front, behindSq, behind } = line;
  if (PIECE_VALUE[front.role] <= PIECE_VALUE[behind.role]) return null;
  if (!isMeaningfulSkewer(pos, attackerSq, attacker, front, behindSq, behind)) return null;
  return {
    kind: "skewer",
    attacker: { role: attacker.role, square: makeSquare(attackerSq) },
    front: { role: front.role, square: makeSquare(frontSq) },
    behind: { role: behind.role, square: makeSquare(behindSq) }
  };
}

/**
 * Geometry alone over-reports pins (every bishop "pins" the f7 pawn to a
 * castled king). A pin is worth reporting when:
 *  - the pinned piece is not a pawn,
 *  - the pinner cannot simply be captured for free,
 *  - it is absolute (king behind), or the piece behind is worth more than both
 *    the pinned piece and the pinner (so breaking the pin loses material), or
 *    the pinned piece itself is already en prise.
 */
function isMeaningfulPin(
  pos: Chess,
  pinnerSq: Square,
  pinner: Piece,
  pinnedSq: Square,
  pinned: Piece,
  behind: Piece
): boolean {
  if (pinned.role === "pawn") return false;
  if (exchangeGain(pos, pinnerSq) > 0) return false;
  if (behind.role === "king") return true;
  if (PIECE_VALUE[behind.role] > PIECE_VALUE[pinner.role]) return true;
  return exchangeGain(pos, pinnedSq) > 0;
}

/**
 * A skewer matters when the front piece must move (king, or a piece worth more
 * than the attacker) and the piece behind can then be won: it is undefended or
 * worth more than the attacker. The attacker must not be capturable for free.
 */
function isMeaningfulSkewer(
  pos: Chess,
  attackerSq: Square,
  attacker: Piece,
  front: Piece,
  behindSq: Square,
  behind: Piece
): boolean {
  if (exchangeGain(pos, attackerSq) > 0) return false;
  if (front.role !== "king" && PIECE_VALUE[front.role] <= PIECE_VALUE[attacker.role]) return false;
  if (behind.role === "pawn") return false;
  const behindColor = pos.board.getColor(behindSq);
  const undefended = behindColor
    ? pos.kingAttackers(behindSq, behindColor, pos.board.occupied).isEmpty()
    : false;
  return undefended || PIECE_VALUE[behind.role] > PIECE_VALUE[attacker.role];
}

function isSlider(role: Role): boolean {
  return role === "bishop" || role === "rook" || role === "queen";
}
