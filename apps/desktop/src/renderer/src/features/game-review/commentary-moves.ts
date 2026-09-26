import { applySan, fenAfterUci } from "@chaturanga/shared/chess/position";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type { MoveReview } from "@chaturanga/shared/types/engine";
import { uciToSan } from "./review-utils";

/**
 * Clickable moves in review prose.
 *
 * AI commentary only names SAN tokens that come from grounded data: the
 * played move, the engine's best line and alternatives (from `fenBefore`), the reply line after the
 * played move (from `fenAfter`) and the game's recent history. This module splits
 * prose into text and SAN tokens, then maps each token back to one of those lines so a click can
 * land on the exact position (see `useGameStore().goToLine`). Every line is replayed with chessops
 * from its start FEN, so a token only becomes a link when the move is legal where it is played.
 */

export type CommentaryMoveToken = {
  kind: "move";
  /** Display text, including any move-number prefix ("14. Nf3", "6…Nf6"). */
  text: string;
  /** The SAN itself, with check/mate suffix ("Bxf7+"). */
  san: string;
  /** Ply implied by a move-number prefix (14. → 27, 14... → 28), when present. */
  plyHint: number | null;
  /** Position of this token among the move tokens of the prose. */
  index: number;
};

export type CommentarySegment = { kind: "text"; text: string } | CommentaryMoveToken;

/** Where a clickable move leads: play `moves` from `startNodeId` (existing nodes are reused). */
export type MoveNavigationTarget = {
  startNodeId: string;
  /** SAN moves from the start node; the last one is the clicked move. */
  moves: string[];
};

type LineKind = "played" | "history" | "reply" | "best" | "alternative" | "human" | "game";

type ResolvedCommentaryMove = MoveNavigationTarget & {
  kind: LineKind;
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
};

export type CommentaryMoveContext = {
  /** The reviewed move the commentary is about. */
  move: MoveReview;
  /** Every reviewed move of the game (used for the older "reply = next ply's best line" fallback). */
  moves: readonly MoveReview[];
  moveTree: readonly MoveNode[];
};

type CandidateLine = {
  startNodeId: string;
  /** Ply of the start position (0 at the initial position). */
  startPly: number;
  sans: string[];
  ucis: string[];
  /** fens[i] is the position before sans[i]; fens[sans.length] the final position. */
  fens: string[];
};

type SearchPass = {
  kind: LineKind;
  line: CandidateLine;
  /** Start indices this pass may match at, in preference order. */
  indices: number[];
};

// Same SAN grammar as the commentary validator (packages/shared/src/llm/commentary.ts), plus an
// optional move-number prefix and check/mate suffix on castling.
const TOKEN_REGEX =
  /(?:\b(\d{1,3})\s?(\.\.\.|…|\.)\s?)?(?<![A-Za-z0-9=])(O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?)([+#]{1,2})?(?![A-Za-z0-9])/g;
const BARE_SQUARE = /^[a-h][1-8]$/;
/** Words around a bare square that make it a square reference ("the knight on d5", "the e4 pawn"). */
const SQUARE_WORD_BEFORE = new Set([
  "on", "to", "from", "at", "onto", "into", "toward", "towards", "square", "squares", "of", "via",
  "over", "near", "around", "the", "controls", "control", "covers", "covering"
]);
const SQUARE_WORD_AFTER = new Set([
  "pawn", "pawns", "square", "squares", "knight", "bishop", "rook", "queen", "king", "file", "diagonal"
]);
/** How far back the grounded history reaches (the payload's recentMoves window) and forward (actual reply). */
const HISTORY_BEFORE = 6;
const HISTORY_AFTER = 2;

/** Split prose into plain text and SAN move tokens. Adjacent text is merged. */
export function tokenizeCommentary(prose: string): CommentarySegment[] {
  const segments: CommentarySegment[] = [];
  let cursor = 0;
  let index = 0;
  const pushText = (text: string) => {
    if (!text) return;
    const last = segments[segments.length - 1];
    if (last?.kind === "text") last.text += text;
    else segments.push({ kind: "text", text });
  };
  for (const match of prose.matchAll(TOKEN_REGEX)) {
    const [full, number, dots, body, suffix] = match;
    const start = match.index ?? 0;
    if (!body) continue;
    const plyHint = number ? Number(number) * 2 - (dots === "." ? 1 : 0) : null;
    if (!number && BARE_SQUARE.test(body) && !suffix && looksLikeSquareReference(prose, start, start + full.length)) {
      continue;
    }
    pushText(prose.slice(cursor, start));
    segments.push({ kind: "move", text: full, san: body + (suffix ?? ""), plyHint, index });
    index += 1;
    cursor = start + full.length;
  }
  pushText(prose.slice(cursor));
  return segments;
}

function looksLikeSquareReference(prose: string, start: number, end: number): boolean {
  const before = prose.slice(0, start).match(/([A-Za-z]+)\W*$/)?.[1]?.toLowerCase();
  const after = prose.slice(end).match(/^\W*([A-Za-z]+)/)?.[1]?.toLowerCase();
  return (before !== undefined && SQUARE_WORD_BEFORE.has(before)) || (after !== undefined && SQUARE_WORD_AFTER.has(after));
}

/**
 * The engine's best continuation for the opponent after the played move: the stored `replyLines`
 * (newer reviews) or, for older reviews, the next ply's best line when it starts from `fenAfter`.
 */
export function replyLineUcis(move: MoveReview, moves: readonly MoveReview[]): string[] {
  const stored = move.replyLines?.find((line) => line.multipv === 1) ?? move.replyLines?.[0];
  if (stored?.pv.length) return stored.pv;
  const next = moves.find((item) => item.ply === move.ply + 1);
  if (next && next.fenBefore === move.fenAfter && next.bestLine.length) return next.bestLine;
  return [];
}

function lineFromUcis(startNodeId: string, startPly: number, startFen: string, ucis: readonly string[]): CandidateLine {
  const line: CandidateLine = { startNodeId, startPly, sans: [], ucis: [], fens: [startFen] };
  let fen = startFen;
  for (const uci of ucis) {
    const san = safe(() => uciToSan(fen, uci));
    const next = san ? safe(() => fenAfterUci(fen, uci)) : null;
    if (!san || !next) break;
    line.sans.push(san);
    line.ucis.push(uci);
    line.fens.push(next);
    fen = next;
  }
  return line;
}

function lineFromSans(startNodeId: string, startPly: number, startFen: string, sans: readonly string[]): CandidateLine {
  const line: CandidateLine = { startNodeId, startPly, sans: [], ucis: [], fens: [startFen] };
  let fen = startFen;
  for (const san of sans) {
    const applied = safe(() => applySan(fen, san));
    if (!applied) break;
    line.sans.push(applied.san);
    line.ucis.push(applied.uci);
    line.fens.push(applied.fen);
    fen = applied.fen;
  }
  return line;
}

function safe<T>(fn: () => T | null): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

function range(length: number): number[] {
  return Array.from({ length }, (_, index) => index);
}

/**
 * Candidate lines in priority order: the played move, nearby game history (nearest first), the
 * reply line, the best line, each alternative, other replies, Maia's human moves, then the rest
 * of the game.
 */
function buildSearchPasses(ctx: CommentaryMoveContext): SearchPass[] {
  const { move, moveTree } = ctx;
  const byId = new Map(moveTree.map((node) => [node.id, node]));
  const root = moveTree.find((node) => node.parentId === null) ?? moveTree[0];
  const passes: SearchPass[] = [];
  if (!root) return passes;

  // Main line from the root, replayed for legality.
  const path: MoveNode[] = [];
  const seen = new Set<string>();
  for (let cursor = byId.get(root.children[0] ?? ""); cursor && !seen.has(cursor.id); cursor = byId.get(cursor.children[0] ?? "")) {
    seen.add(cursor.id);
    path.push(cursor);
  }
  const mainline = lineFromSans(root.id, root.ply, root.fenAfter, path.map((node) => node.san ?? ""));
  const playedIndex = path.findIndex((node) => node.id === move.nodeId);
  const node = byId.get(move.nodeId);
  const parentId = node?.parentId ?? null;
  const moveStartPly = move.ply - 1;

  if (playedIndex >= 0 && playedIndex < mainline.sans.length) {
    passes.push({ kind: "played", line: mainline, indices: [playedIndex] });
    const near = range(mainline.sans.length)
      .filter((index) => index !== playedIndex && index >= playedIndex - HISTORY_BEFORE && index <= playedIndex + HISTORY_AFTER)
      .sort((a, b) => Math.abs(a - playedIndex) - Math.abs(b - playedIndex) || b - a);
    passes.push({ kind: "history", line: mainline, indices: near });
  } else if (parentId) {
    const played = lineFromUcis(parentId, moveStartPly, move.fenBefore, [move.playedMove]);
    passes.push({ kind: "played", line: played, indices: range(played.sans.length) });
  }

  const pushLine = (kind: LineKind, line: CandidateLine) => {
    if (line.sans.length) passes.push({ kind, line, indices: range(line.sans.length) });
  };
  const reply = replyLineUcis(move, ctx.moves);
  if (node && reply.length) pushLine("reply", lineFromUcis(node.id, move.ply, move.fenAfter, reply));
  if (parentId) {
    const best = move.bestLine.length ? move.bestLine : move.bestMove ? [move.bestMove] : [];
    pushLine("best", lineFromUcis(parentId, moveStartPly, move.fenBefore, best));
    const bestKey = best.join(" ");
    for (const line of [...move.topLines].sort((a, b) => a.multipv - b.multipv)) {
      if (line.pv.join(" ") === bestKey) continue;
      pushLine("alternative", lineFromUcis(parentId, moveStartPly, move.fenBefore, line.pv));
    }
  }
  if (node) {
    const replyKey = reply.join(" ");
    for (const line of [...(move.replyLines ?? [])].sort((a, b) => a.multipv - b.multipv)) {
      if (line.pv.join(" ") === replyKey) continue;
      pushLine("reply", lineFromUcis(node.id, move.ply, move.fenAfter, line.pv));
    }
  }
  if (parentId) {
    for (const prediction of move.humanPredictions ?? []) {
      for (const candidate of prediction.topMoves.slice(0, 5)) {
        pushLine("human", lineFromUcis(parentId, moveStartPly, move.fenBefore, [candidate.uci]));
      }
    }
  }
  if (mainline.sans.length) {
    const center = playedIndex >= 0 ? playedIndex : 0;
    const covered = new Set(passes.filter((pass) => pass.line === mainline).flatMap((pass) => pass.indices));
    const rest = range(mainline.sans.length)
      .filter((index) => !covered.has(index))
      .sort((a, b) => Math.abs(a - center) - Math.abs(b - center) || a - b);
    passes.push({ kind: "game", line: mainline, indices: rest });
  }
  return passes;
}

function normalizeSan(san: string): string {
  return san.replace(/[+#!?]+$/, "").replace(/^0-0-0$/, "O-O-O").replace(/^0-0$/, "O-O");
}

function tokenMatches(token: CommentaryMoveToken, line: CandidateLine, index: number): boolean {
  const lineSan = line.sans[index];
  if (!lineSan) return false;
  const a = normalizeSan(token.san);
  const b = normalizeSan(lineSan);
  if (a === b) return true;
  // Over- or under-disambiguated SAN ("Nbd2" for "Nd2"): same destination, same move when legal.
  if (a.slice(-2) !== b.slice(-2) && !a.startsWith("O-O")) return false;
  const fen = line.fens[index];
  const after = line.fens[index + 1];
  return Boolean(fen && after && safe(() => applySan(fen, a))?.fen === after);
}

function findRunMatch(
  tokens: readonly CommentaryMoveToken[],
  passes: readonly SearchPass[],
  strictHints: boolean
): { pass: SearchPass; start: number } | null {
  for (const pass of passes) {
    for (const start of pass.indices) {
      if (start + tokens.length > pass.line.sans.length) continue;
      let ok = true;
      for (let offset = 0; offset < tokens.length && ok; offset += 1) {
        const token = tokens[offset];
        if (!token) {
          ok = false;
          break;
        }
        ok = tokenMatches(token, pass.line, start + offset);
        if (ok && strictHints && token.plyHint !== null) ok = token.plyHint === pass.line.startPly + start + offset + 1;
      }
      if (ok) return { pass, start };
    }
  }
  return null;
}

function resolvedAt(pass: SearchPass, index: number): ResolvedCommentaryMove {
  const { line } = pass;
  return {
    kind: pass.kind,
    startNodeId: line.startNodeId,
    moves: line.sans.slice(0, index + 1),
    san: line.sans[index] ?? "",
    uci: line.ucis[index] ?? "",
    fenBefore: line.fens[index] ?? "",
    fenAfter: line.fens[index + 1] ?? ""
  };
}

/** Resolve a run of prose-adjacent tokens, keeping consecutive tokens of one line together. */
function resolveRun(
  run: readonly CommentaryMoveToken[],
  passes: readonly SearchPass[],
  out: Map<number, ResolvedCommentaryMove>
): void {
  let position = 0;
  while (position < run.length) {
    let matched = false;
    for (const strict of [true, false]) {
      for (let length = run.length - position; length >= 1 && !matched; length -= 1) {
        const slice = run.slice(position, position + length);
        const found = findRunMatch(slice, passes, strict);
        if (!found) continue;
        slice.forEach((token, offset) => out.set(token.index, resolvedAt(found.pass, found.start + offset)));
        position += length;
        matched = true;
      }
      if (matched) break;
    }
    if (!matched) position += 1;
  }
}

/**
 * Resolve every move token of tokenized prose. Tokens separated only by whitespace form a run and
 * are matched as consecutive moves of one line when possible ("Qb3 Bc5 Bxf7+"): clicking the third
 * lands after the whole prefix. Unresolvable tokens are absent from the map (render as text).
 */
/** Search passes per context: a panel resolves its headline, prose and tip against the same lines. */
const searchPassCache = new WeakMap<CommentaryMoveContext, SearchPass[]>();

function searchPassesFor(ctx: CommentaryMoveContext): SearchPass[] {
  let passes = searchPassCache.get(ctx);
  if (!passes) {
    passes = buildSearchPasses(ctx);
    searchPassCache.set(ctx, passes);
  }
  return passes;
}

export function resolveCommentaryMoves(
  segments: readonly CommentarySegment[],
  ctx: CommentaryMoveContext,
  passes: readonly SearchPass[] = searchPassesFor(ctx)
): Map<number, ResolvedCommentaryMove> {
  const out = new Map<number, ResolvedCommentaryMove>();
  let run: CommentaryMoveToken[] = [];
  const flush = () => {
    if (run.length) resolveRun(run, passes, out);
    run = [];
  };
  for (const segment of segments) {
    if (segment.kind === "move") run.push(segment);
    else if (!/^\s*$/.test(segment.text)) flush();
  }
  flush();
  return out;
}

/**
 * The reviewed move commentary should anchor to for `nodeId`: the node's own review, or — on an
 * unreviewed variation — a reviewed move it hangs off. `variation` is true in the latter case.
 *
 * `preferredNodeId` is the move whose commentary a move link was clicked from. Its best line and
 * alternatives branch from its *parent*, so the nearest reviewed ancestor of such a variation is
 * the previous ply; the preferred move keeps the anchor while `nodeId` lies below it or below its
 * parent. Otherwise the nearest reviewed ancestor is used.
 */
export function reviewAnchorFor(
  moveTree: readonly MoveNode[],
  nodeId: string,
  reviewByNodeId: ReadonlyMap<string, MoveReview>,
  preferredNodeId: string | null = null
): { move: MoveReview; variation: boolean } | null {
  const own = reviewByNodeId.get(nodeId);
  if (own) return { move: own, variation: false };
  const byId = new Map(moveTree.map((node) => [node.id, node]));
  const root = moveTree.find((node) => node.parentId === null);
  const mainline = new Set<string>();
  for (let cursor = root; cursor && !mainline.has(cursor.id); cursor = byId.get(cursor.children[0] ?? "")) mainline.add(cursor.id);
  if (mainline.has(nodeId)) return null;
  const ancestors: string[] = [];
  const seen = new Set<string>();
  for (let cursor = byId.get(nodeId); cursor?.parentId && !seen.has(cursor.id); cursor = byId.get(cursor.parentId)) {
    seen.add(cursor.id);
    ancestors.push(cursor.parentId);
  }
  const preferred = preferredNodeId ? reviewByNodeId.get(preferredNodeId) : undefined;
  const preferredParent = preferredNodeId ? byId.get(preferredNodeId)?.parentId ?? null : null;
  if (preferred && preferredNodeId && (ancestors.includes(preferredNodeId) || (preferredParent !== null && ancestors.includes(preferredParent)))) {
    return { move: preferred, variation: true };
  }
  for (const ancestorId of ancestors) {
    const review = reviewByNodeId.get(ancestorId);
    if (review) return { move: review, variation: true };
  }
  return null;
}
