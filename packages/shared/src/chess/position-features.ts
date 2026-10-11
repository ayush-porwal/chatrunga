import type { Chess } from "chessops/chess";
import { attacks, between, kingAttacks, ray } from "chessops/attacks";
import type { SquareSet } from "chessops/squareSet";
import {
  makeSquare,
  opposite,
  parseSquare,
  squareFile,
  squareFromCoords,
  squareRank
} from "chessops/util";
import type { Color, Role, Square } from "chessops/types";
import { positionFromFen } from "./position";

/**
 * Deterministic positional features for the review coach.
 *
 * Everything here is computed from the board alone (no engine), and is phrased
 * as short plain-English strings that only name squares which are occupied or
 * otherwise concrete, so the coach can talk about ideas ("your king has no
 * pawn shield", "Black has a passed d-pawn") without being allowed to invent
 * a position of its own.
 */

/** Conventional material points (the king is not counted). */
export const PIECE_POINTS: Record<Role, number> = {
  pawn: 1,
  knight: 3,
  bishop: 3,
  rook: 5,
  queen: 9,
  king: 0
};

/** Exchange weight: material points, with the king as a very expensive capturer. */
export function pieceWeight(role: Role): number {
  return role === "king" ? 100 : PIECE_POINTS[role];
}

const ROLE_LETTER: Record<Role, string> = {
  king: "K",
  queen: "Q",
  rook: "R",
  bishop: "B",
  knight: "N",
  pawn: "P"
};
const ROLE_ORDER: Role[] = ["king", "queen", "rook", "bishop", "knight", "pawn"];
const FILES = "abcdefgh";
const CENTER: Square[] = [
  parseSquare("d4"),
  parseSquare("e4"),
  parseSquare("d5"),
  parseSquare("e5")
];

export function sideName(color: Color): string {
  return color === "white" ? "White" : "Black";
}

/** "knight on e3" */
export function pieceOn(pos: Chess, square: Square): string {
  const role = pos.board.getRole(square);
  return `${role ?? "piece"} on ${makeSquare(square)}`;
}

export function attackersOf(pos: Chess, square: Square, by: Color): SquareSet {
  return pos.kingAttackers(square, by, pos.board.occupied);
}

/** The enemy slider that pins the piece on `square` to its own king, if any. */
export function pinnerOf(pos: Chess, square: Square): Square | undefined {
  const color = pos.board.getColor(square);
  if (!color) return undefined;
  const king = pos.board.kingOf(color);
  if (king === undefined || king === square || !ray(king, square).has(square)) return undefined;
  for (const sq of pos.board[opposite(color)]) {
    const role = pos.board.getRole(sq);
    if (role !== "bishop" && role !== "rook" && role !== "queen") continue;
    if (!ray(king, sq).has(square) || !between(king, sq).has(square)) continue;
    // The slider must actually move along this line, and nothing else may stand between.
    const piece = pos.board.get(sq);
    if (!piece || !attacks(piece, sq, pos.board.occupied.without(square)).has(king)) continue;
    if (between(king, sq).intersect(pos.board.occupied).size() === 1) return sq;
  }
  return undefined;
}

/**
 * Static exchange on `square`: material the side attacking it wins (points,
 * may be negative) by capturing there first. Cheapest attacker first, cheapest
 * defender recaptures; x-rays and pins are ignored.
 */
export function exchangeGain(pos: Chess, square: Square): number {
  const victimRole = pos.board.getRole(square);
  const victimColor = pos.board.getColor(square);
  if (!victimRole || !victimColor || victimRole === "king") return 0;
  const values = (set: SquareSet) =>
    Array.from(set, (sq) => pos.board.getRole(sq))
      .filter((role): role is Role => Boolean(role))
      .map(pieceWeight)
      .sort((a, b) => a - b);
  const attackers = values(attackersOf(pos, square, opposite(victimColor)));
  const defenders = values(attackersOf(pos, square, victimColor));
  const first = attackers.at(0);
  if (first === undefined) return 0;
  // Classic swap list: gain[d] is the attacker's balance if the sequence stops
  // after capture d; resolve backwards so either side may stop when continuing loses.
  const gain: number[] = [PIECE_POINTS[victimRole]];
  let lastCapturer = first;
  let ai = 1;
  let di = 0;
  let defenderTurn = true;
  const nextTaker = () => (defenderTurn ? defenders.at(di++) : attackers.at(ai++));
  for (let taker = nextTaker(); taker !== undefined; taker = nextTaker()) {
    gain.push(lastCapturer - (gain[gain.length - 1] ?? 0));
    lastCapturer = taker;
    defenderTurn = !defenderTurn;
  }
  for (let d = gain.length - 1; d > 0; d--) {
    gain[d - 1] = -Math.max(-(gain[d - 1] ?? 0), gain[d] ?? 0);
  }
  return gain[0] ?? 0;
}

/** "K g1; Q e2; R a1 f1; B c1; N f3; P a2 b2 c3" — a compact, non-SAN piece list. */
export function describeBoard(fen: string): { white: string; black: string } | null {
  try {
    const pos = positionFromFen(fen);
    const side = (color: Color) =>
      ROLE_ORDER.map((role) => {
        const squares = Array.from(pos.board.pieces(color, role), makeSquare);
        return squares.length ? `${ROLE_LETTER[role]} ${squares.join(" ")}` : null;
      })
        .filter(Boolean)
        .join("; ");
    return { white: side("white"), black: side("black") };
  } catch {
    return null;
  }
}

export type PositionSnapshot = {
  material: string;
  white: string;
  black: string;
  files?: string;
  center?: string;
};

type SideFeatures = {
  king: string[];
  development: string[];
  pawns: string[];
  /** Comparable tags for before/after diffs. */
  tags: Set<string>;
};

function materialText(pos: Chess): string {
  const counts = (color: Color) => {
    const parts: string[] = [];
    let points = 0;
    for (const role of ["queen", "rook", "bishop", "knight", "pawn"] as const) {
      const n = pos.board.pieces(color, role).size();
      points += n * PIECE_POINTS[role];
      if (n) parts.push(`${n > 1 ? n : ""}${ROLE_LETTER[role]}`);
    }
    return { text: parts.join(" ") || "king only", points };
  };
  const white = counts("white");
  const black = counts("black");
  const diff = white.points - black.points;
  let balance = "material is level";
  if (diff !== 0) {
    const leader = diff > 0 ? "White" : "Black";
    const extras = (color: Color) =>
      (["queen", "rook", "bishop", "knight", "pawn"] as const)
        .map((role) => {
          const n =
            pos.board.pieces(color, role).size() - pos.board.pieces(opposite(color), role).size();
          return n > 0 ? `${n > 1 ? `${n} ` : ""}${role}${n > 1 ? "s" : ""}` : null;
        })
        .filter(Boolean)
        .join(", ");
    const leaderColor: Color = diff > 0 ? "white" : "black";
    const plus = extras(leaderColor);
    const minus = extras(opposite(leaderColor));
    const detail = minus ? `${plus} against ${minus}` : `extra ${plus}`;
    balance = `${leader} is ahead by ${Math.abs(diff)} point${Math.abs(diff) === 1 ? "" : "s"} (${detail})`;
  }
  return `White ${white.text}; Black ${black.text}; ${balance}`;
}

function pawnFiles(pos: Chess, color: Color): number[] {
  const counts = Array.from({ length: 8 }, () => 0);
  for (const sq of pos.board.pieces(color, "pawn"))
    counts[squareFile(sq)] = (counts[squareFile(sq)] ?? 0) + 1;
  return counts;
}

function isPassed(pos: Chess, color: Color, square: Square): boolean {
  const file = squareFile(square);
  const rank = squareRank(square);
  for (const enemy of pos.board.pieces(opposite(color), "pawn")) {
    const f = squareFile(enemy);
    const r = squareRank(enemy);
    if (Math.abs(f - file) > 1) continue;
    if (color === "white" ? r > rank : r < rank) return false;
  }
  return true;
}

/** Lines of a side's description, with the comparable tags they add (in order). */
type FeatureGroup = { lines: string[]; tags: string[] };

const NO_FEATURES: FeatureGroup = { lines: [], tags: [] };

function sideFeatures(pos: Chess, color: Color, early: boolean): SideFeatures {
  const own = pawnFiles(pos, color);
  const ksq = pos.board.kingOf(color);
  const king = ksq === undefined ? NO_FEATURES : kingFeatures(pos, color, ksq, own);
  const development = early ? developmentFeatures(pos, color) : NO_FEATURES;
  const pawns = pawnFeatures(pos, color, own);
  return {
    king: king.lines,
    development: development.lines,
    pawns: pawns.lines,
    tags: new Set([...king.tags, ...development.tags, ...pawns.tags])
  };
}

/** Where a side's king stands, for the king-safety details. */
type KingSituation = {
  pos: Chess;
  color: Color;
  ksq: Square;
  file: number;
  rank: number;
  /** The side's back rank, and the direction its pawns advance. */
  home: number;
  dir: number;
  /** The side's pawn count per file. */
  own: readonly number[];
  /** King-safety details only matter while the opponent has attacking pieces. */
  exposedMatters: boolean;
};

function kingFeatures(pos: Chess, color: Color, ksq: Square, own: readonly number[]): FeatureGroup {
  const attackingMaterial = (["queen", "rook", "bishop", "knight"] as const).reduce(
    (sum, role) => sum + pos.board.pieces(opposite(color), role).size() * PIECE_POINTS[role],
    0
  );
  const king: KingSituation = {
    pos,
    color,
    ksq,
    file: squareFile(ksq),
    rank: squareRank(ksq),
    home: color === "white" ? 0 : 7,
    dir: color === "white" ? 1 : -1,
    own,
    exposedMatters: pos.board.pieces(opposite(color), "queen").nonEmpty() || attackingMaterial >= 13
  };
  const groups = [
    { lines: [kingPlacement(king)], tags: [] },
    castlingFeatures(king),
    king.exposedMatters ? pawnShieldFeatures(king) : NO_FEATURES,
    king.exposedMatters ? openFilesByKing(king) : NO_FEATURES,
    kingPressure(king),
    { lines: attackersOf(pos, ksq, opposite(color)).nonEmpty() ? ["in check"] : [], tags: [] }
  ];
  return {
    lines: groups.flatMap((group) => group.lines),
    tags: groups.flatMap((group) => group.tags)
  };
}

function kingPlacement({ ksq, file, rank, home, exposedMatters }: KingSituation): string {
  const kingName = `king ${makeSquare(ksq)}`;
  if (!exposedMatters) return kingName;
  if (rank !== home) return `${kingName} (off the back rank)`;
  if (file >= 6) return `${kingName} (castled short side)`;
  if (file <= 2) return `${kingName} (castled long side)`;
  return `${kingName} (in the center)`;
}

function castlingFeatures({ pos, color, file, rank, home }: KingSituation): FeatureGroup {
  const rights: string[] = [];
  if (pos.castles.rook[color].h !== undefined) rights.push("short");
  if (pos.castles.rook[color].a !== undefined) rights.push("long");
  const lines =
    rank === home && file >= 3 && file <= 5
      ? [rights.length ? `can still castle ${rights.join(" or ")}` : "can no longer castle"]
      : [];
  return { lines, tags: rights.map((right) => `can castle ${right}`) };
}

/** The pawns in front of a king on (or just off) its back rank. */
function pawnShieldFeatures({ pos, color, file, rank, home, dir }: KingSituation): FeatureGroup {
  if (rank !== home && rank !== home + dir) return NO_FEATURES;
  const shield: string[] = [];
  for (let f = file - 1; f <= file + 1; f++) {
    for (const step of [1, 2]) {
      const sq = squareFromCoords(f, rank + dir * step);
      if (
        sq !== undefined &&
        pos.board.get(sq)?.role === "pawn" &&
        pos.board.getColor(sq) === color
      )
        shield.push(makeSquare(sq));
    }
  }
  return shield.length
    ? { lines: [`pawn shield ${shield.join(" ")}`], tags: [] }
    : { lines: ["no pawn shield"], tags: ["no pawn shield"] };
}

function openFilesByKing({ pos, color, file, own }: KingSituation): FeatureGroup {
  const theirs = pawnFiles(pos, opposite(color));
  const group: FeatureGroup = { lines: [], tags: [] };
  for (let f = Math.max(0, file - 1); f <= Math.min(7, file + 1); f++) {
    if ((own[f] ?? 0) > 0) continue;
    const kind = (theirs[f] ?? 0) > 0 ? "half-open" : "open";
    group.lines.push(`${kind} ${FILES[f]}-file next to the king`);
    group.tags.push(`${kind} ${FILES[f]}-file by the king`);
  }
  return group;
}

/** The enemy pieces (not the king) attacking the king's square or the squares around it. */
function kingPressure({ pos, color, ksq }: KingSituation): FeatureGroup {
  const eyeing = new Set<Square>();
  for (const sq of kingAttacks(ksq).with(ksq))
    for (const attacker of attackersOf(pos, sq, opposite(color))) eyeing.add(attacker);
  const eyeingNames = Array.from(eyeing)
    .filter((sq) => pos.board.getRole(sq) !== "king")
    .map((sq) => pieceOn(pos, sq).replace(" on ", " "));
  if (!eyeingNames.length) return NO_FEATURES;
  return {
    lines: [`enemy pieces hitting the king's squares: ${eyeingNames.slice(0, 3).join(", ")}`],
    tags: [`king pressured by ${eyeingNames.length}`]
  };
}

/** The minor pieces still on their starting squares. */
function developmentFeatures(pos: Chess, color: Color): FeatureGroup {
  const home = color === "white" ? 0 : 7;
  const undeveloped: string[] = [];
  for (const role of ["knight", "bishop"] as const) {
    for (const sq of pos.board.pieces(color, role)) {
      const start = role === "knight" ? [1, 6] : [2, 5];
      if (squareRank(sq) === home && start.includes(squareFile(sq)))
        undeveloped.push(`${role} ${makeSquare(sq)}`);
    }
  }
  return {
    lines: [
      undeveloped.length ? `undeveloped: ${undeveloped.join(", ")}` : "minor pieces developed"
    ],
    tags: undeveloped.map((item) => `undeveloped ${item}`)
  };
}

function pawnFeatures(pos: Chess, color: Color, own: readonly number[]): FeatureGroup {
  const isolated: string[] = [];
  const passed: string[] = [];
  for (const sq of pos.board.pieces(color, "pawn")) {
    const f = squareFile(sq);
    if (!(own[f - 1] ?? 0) && !(own[f + 1] ?? 0)) isolated.push(makeSquare(sq));
    if (isPassed(pos, color, sq)) passed.push(makeSquare(sq));
  }
  const doubled = own.flatMap((count, f) => (count > 1 ? [FILES[f]] : []));
  const lines: string[] = [];
  if (isolated.length) lines.push(`isolated ${isolated.join(" ")}`);
  if (doubled.length) lines.push(`doubled ${doubled.join(", ")}-pawns`);
  if (passed.length) lines.push(`passed ${passed.join(" ")}`);
  return {
    lines,
    tags: [
      ...isolated.map((sq) => `isolated pawn ${sq}`),
      ...doubled.map((f) => `doubled ${f}-pawns`),
      ...passed.map((sq) => `passed pawn ${sq}`)
    ]
  };
}

function filesText(pos: Chess): { text?: string; tags: Set<string> } {
  const white = pawnFiles(pos, "white");
  const black = pawnFiles(pos, "black");
  const open: string[] = [];
  const halfWhite: string[] = [];
  const halfBlack: string[] = [];
  for (let f = 0; f < 8; f++) {
    const w = white[f] ?? 0;
    const b = black[f] ?? 0;
    const name = FILES[f] ?? "";
    if (!w && !b) open.push(name);
    else if (!w) halfWhite.push(name);
    else if (!b) halfBlack.push(name);
  }
  const parts: string[] = [];
  if (open.length) parts.push(`open: ${open.join(" ")}`);
  if (halfWhite.length) parts.push(`half-open for White: ${halfWhite.join(" ")}`);
  if (halfBlack.length) parts.push(`half-open for Black: ${halfBlack.join(" ")}`);
  const tags = new Set(open.map((f) => `open ${f}-file`));
  return { text: parts.length ? parts.join("; ") : undefined, tags };
}

function centerText(pos: Chess): string {
  const count = (color: Color) => {
    let n = 0;
    for (const sq of CENTER) {
      n += attackersOf(pos, sq, color).size();
      if (pos.board.getColor(sq) === color) n += 1;
    }
    return n;
  };
  return `center control (d4 e4 d5 e5, pieces + attacks): White ${count("white")}, Black ${count("black")}`;
}

function sideText(features: SideFeatures): string {
  return [...features.king, ...features.development, ...features.pawns].join("; ");
}

export type SnapshotResult = {
  snapshot: PositionSnapshot;
  tags: { white: Set<string>; black: Set<string>; shared: Set<string> };
};

/** Compact positional snapshot. `early` adds development info (opening / early middlegame). */
export function positionSnapshot(fen: string, early: boolean): SnapshotResult | null {
  try {
    const pos = positionFromFen(fen);
    const white = sideFeatures(pos, "white", early);
    const black = sideFeatures(pos, "black", early);
    const files = filesText(pos);
    return {
      snapshot: {
        material: materialText(pos),
        white: sideText(white),
        black: sideText(black),
        ...(files.text ? { files: files.text } : {}),
        center: centerText(pos)
      },
      tags: { white: white.tags, black: black.tags, shared: files.tags }
    };
  } catch {
    return null;
  }
}

/** What changed structurally between two snapshots ("Black gained: passed pawn d3"). */
export function snapshotChanges(before: SnapshotResult, after: SnapshotResult): string[] {
  const changes: string[] = [];
  const diff = (a: Set<string>, b: Set<string>) => Array.from(b).filter((tag) => !a.has(tag));
  for (const color of ["white", "black"] as const) {
    const gained = diff(before.tags[color], after.tags[color]).filter(
      (tag) => !tag.startsWith("king pressured")
    );
    const lost = diff(after.tags[color], before.tags[color]).filter(
      (tag) => !tag.startsWith("king pressured")
    );
    if (gained.length) changes.push(`${sideName(color)} now has: ${gained.slice(0, 3).join(", ")}`);
    if (lost.length)
      changes.push(`${sideName(color)} no longer has: ${lost.slice(0, 3).join(", ")}`);
  }
  const opened = diff(before.tags.shared, after.tags.shared);
  if (opened.length) changes.push(`newly ${opened.join(", ")}`);
  return changes.slice(0, 5);
}
