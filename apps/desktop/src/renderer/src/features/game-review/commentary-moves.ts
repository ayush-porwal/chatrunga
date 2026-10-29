import { applySan, fenAfterUci } from "@chaturanga/shared/chess/position";
import { isSquare } from "@chaturanga/shared/chess/square";
import type { MoveNode, Square } from "@chaturanga/shared/types/chess";
import type { MoveReview } from "@chaturanga/shared/types/engine";
import { uciToSan } from "./review-utils";

/**
 * Clickable moves in review prose.
 *
 * AI commentary only names SAN tokens that come from grounded data: the
 * played move, the engine's best line and alternatives (from `fenBefore`), the reply line after the
 * played move (from `fenAfter`) and the game's recent history. This module splits
 * prose into text, SAN tokens and square references ("the bishop on f6"), then maps each SAN token
 * back to one of those lines so a click can land on the exact position. Every line is replayed with
 * chessops from its start FEN, so a token only becomes a link when the move is legal where it is
 * played.
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

/** A square the prose names as a square ("the knight on d5", "off a1", "the e4 pawn"). */
export type CommentarySquareToken = { kind: "square"; text: string; square: Square };

export type CommentarySegment =
  | { kind: "text"; text: string }
  | CommentaryMoveToken
  | CommentarySquareToken;

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
/**
 * Words before a bare square that make it a square reference ("the knight on d5", "off a1", "hits
 * your queen on d3"). Not "of": "instead of h3" names a pawn move (an unresolved bare square still
 * reads as a square, see CommentaryProse).
 */
const SQUARE_WORD_BEFORE = new Set([
  "on",
  "to",
  "from",
  "at",
  "off",
  "onto",
  "into",
  "toward",
  "towards",
  "square",
  "squares",
  "via",
  "over",
  "near",
  "around",
  "the",
  "controls",
  "control",
  "covers",
  "covering",
  "hits",
  "hitting",
  "attacks",
  "attacking",
  "targets",
  "targeting",
  "eyes",
  "eyeing",
  "guards",
  "guarding",
  "defends",
  "defending",
  "protects",
  "protecting"
]);
const SQUARE_WORD_AFTER = new Set([
  "pawn",
  "pawns",
  "square",
  "squares",
  "knight",
  "bishop",
  "rook",
  "queen",
  "king",
  "file",
  "diagonal"
]);
/** How far back the grounded history reaches (the payload's recentMoves window) and forward (actual reply). */
const HISTORY_BEFORE = 6;
const HISTORY_AFTER = 2;

/**
 * Split prose into plain text, SAN move tokens and square references. A bare square ("f6") is a
 * square when a square word comes before it or a piece word after it; otherwise it is a move token
 * (a pawn move, when it resolves). Adjacent text is merged.
 */
export function tokenizeCommentary(prose: string): CommentarySegment[] {
  const segments: CommentarySegment[] = [];
  let cursor = 0;
  let index = 0;
  const pushText = (text: string) => {
    if (!text) return;
    const last = segments.at(-1);
    if (last?.kind === "text") last.text += text;
    else segments.push({ kind: "text", text });
  };
  for (const match of prose.matchAll(TOKEN_REGEX)) {
    const [full, number, dots, body] = match;
    // The check/mate suffix is an optional group: absent when the move has none.
    const suffix = match.at(4) ?? "";
    const start = match.index;
    if (!body) continue;
    const plyHint = number ? Number(number) * 2 - (dots === "." ? 1 : 0) : null;
    pushText(prose.slice(cursor, start));
    cursor = start + full.length;
    if (
      !number &&
      !suffix &&
      isSquare(body) &&
      looksLikeSquareReference(prose, start, start + full.length)
    ) {
      segments.push({ kind: "square", text: full, square: body });
      continue;
    }
    segments.push({ kind: "move", text: full, san: body + suffix, plyHint, index });
    index += 1;
  }
  pushText(prose.slice(cursor));
  return segments;
}

/**
 * The square a move token names when it is a bare square ("c3": no number, piece or suffix): a
 * pawn move if it resolves to one, else the square itself. Null for any other move.
 */
export function bareSquareOf(token: Pick<CommentaryMoveToken, "san" | "plyHint">): Square | null {
  return token.plyHint === null && isSquare(token.san) ? token.san : null;
}

function looksLikeSquareReference(prose: string, start: number, end: number): boolean {
  const before = prose
    .slice(0, start)
    .match(/([A-Za-z]+)\W*$/)?.[1]
    ?.toLowerCase();
  const after = prose
    .slice(end)
    .match(/^\W*([A-Za-z]+)/)?.[1]
    ?.toLowerCase();
  return (
    (before !== undefined && SQUARE_WORD_BEFORE.has(before)) ||
    (after !== undefined && SQUARE_WORD_AFTER.has(after))
  );
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

function lineFromUcis(
  startNodeId: string,
  startPly: number,
  startFen: string,
  ucis: readonly string[]
): CandidateLine {
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

function lineFromSans(
  startNodeId: string,
  startPly: number,
  startFen: string,
  sans: readonly string[]
): CandidateLine {
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

/** The game's main line from the root, replayed for legality (null for an empty tree). */
function gameMainline(moveTree: readonly MoveNode[]) {
  const byId = new Map(moveTree.map((node) => [node.id, node]));
  const root = moveTree.find((node) => node.parentId === null) ?? moveTree.at(0);
  if (!root) return null;
  const path: MoveNode[] = [];
  const seen = new Set<string>();
  for (
    let cursor = byId.get(root.children[0] ?? "");
    cursor && !seen.has(cursor.id);
    cursor = byId.get(cursor.children[0] ?? "")
  ) {
    seen.add(cursor.id);
    path.push(cursor);
  }
  const line = lineFromSans(
    root.id,
    root.ply,
    root.fenAfter,
    path.map((node) => node.san ?? "")
  );
  return { line, path };
}

/**
 * The played move: in the main line when it is there (with the game history around it, nearest
 * first), else on its own from its parent.
 */
function playedPasses(
  move: MoveReview,
  mainline: CandidateLine,
  playedIndex: number,
  parentId: string | null
): SearchPass[] {
  if (playedIndex >= 0 && playedIndex < mainline.sans.length) {
    const near = range(mainline.sans.length)
      .filter(
        (index) =>
          index !== playedIndex &&
          index >= playedIndex - HISTORY_BEFORE &&
          index <= playedIndex + HISTORY_AFTER
      )
      .sort((a, b) => Math.abs(a - playedIndex) - Math.abs(b - playedIndex) || b - a);
    return [
      { kind: "played", line: mainline, indices: [playedIndex] },
      { kind: "history", line: mainline, indices: near }
    ];
  }
  if (!parentId) return [];
  const played = lineFromUcis(parentId, move.ply - 1, move.fenBefore, [move.playedMove]);
  return [{ kind: "played", line: played, indices: range(played.sans.length) }];
}

type Candidate = { kind: LineKind; line: CandidateLine };

/** The engine's lines from before the move (its parent): the best line, then each other one. */
function engineCandidates(move: MoveReview, parentId: string): Candidate[] {
  const fromParent = (ucis: readonly string[]) =>
    lineFromUcis(parentId, move.ply - 1, move.fenBefore, ucis);
  const best = move.bestLine.length ? move.bestLine : move.bestMove ? [move.bestMove] : [];
  const bestKey = best.join(" ");
  const alternatives = [...move.topLines]
    .sort((a, b) => a.multipv - b.multipv)
    .filter((line) => line.pv.join(" ") !== bestKey);
  return [
    { kind: "best", line: fromParent(best) },
    ...alternatives.map((line): Candidate => ({ kind: "alternative", line: fromParent(line.pv) }))
  ];
}

/** The engine's other replies to the played move (its node), after the reply line itself. */
function otherReplyCandidates(
  move: MoveReview,
  nodeId: string,
  reply: readonly string[]
): Candidate[] {
  const replyKey = reply.join(" ");
  return [...(move.replyLines ?? [])]
    .sort((a, b) => a.multipv - b.multipv)
    .filter((line) => line.pv.join(" ") !== replyKey)
    .map((line) => ({
      kind: "reply",
      line: lineFromUcis(nodeId, move.ply, move.fenAfter, line.pv)
    }));
}

/**
 * Maia's human moves from before the move (its parent): the top five at the mover's rating (Maia
 * 3), then at each rating of the curve, each move once.
 */
function humanCandidates(move: MoveReview, parentId: string): Candidate[] {
  const predictions = [
    ...(move.moverPrediction ? [move.moverPrediction] : []),
    ...(move.humanPredictions ?? [])
  ];
  const ucis = new Set(
    predictions.flatMap((prediction) => prediction.topMoves.slice(0, 5).map((item) => item.uci))
  );
  return Array.from(ucis, (uci) => ({
    kind: "human",
    line: lineFromUcis(parentId, move.ply - 1, move.fenBefore, [uci])
  }));
}

/** The rest of the main line (what no pass covers yet), nearest the played move first. */
function restOfGamePass(
  mainline: CandidateLine,
  playedIndex: number,
  passes: readonly SearchPass[]
): SearchPass {
  const center = playedIndex >= 0 ? playedIndex : 0;
  const covered = new Set(
    passes.filter((pass) => pass.line === mainline).flatMap((pass) => pass.indices)
  );
  const rest = range(mainline.sans.length)
    .filter((index) => !covered.has(index))
    .sort((a, b) => Math.abs(a - center) - Math.abs(b - center) || a - b);
  return { kind: "game", line: mainline, indices: rest };
}

/**
 * Candidate lines in priority order: the played move, nearby game history (nearest first), the
 * reply line, the best line, each alternative, other replies, Maia's human moves, then the rest
 * of the game.
 */
function buildSearchPasses(ctx: CommentaryMoveContext): SearchPass[] {
  const { move, moveTree } = ctx;
  const game = gameMainline(moveTree);
  if (!game) return [];
  const mainline = game.line;
  const playedIndex = game.path.findIndex((node) => node.id === move.nodeId);
  const node = moveTree.find((item) => item.id === move.nodeId);
  const parentId = node?.parentId ?? null;
  const passes = playedPasses(move, mainline, playedIndex, parentId);

  const reply = replyLineUcis(move, ctx.moves);
  const candidates: Candidate[] = [
    ...(node && reply.length
      ? [{ kind: "reply" as const, line: lineFromUcis(node.id, move.ply, move.fenAfter, reply) }]
      : []),
    ...(parentId ? engineCandidates(move, parentId) : []),
    ...(node ? otherReplyCandidates(move, node.id, reply) : []),
    ...(parentId ? humanCandidates(move, parentId) : [])
  ];
  for (const { kind, line } of candidates)
    if (line.sans.length) passes.push({ kind, line, indices: range(line.sans.length) });
  if (mainline.sans.length) passes.push(restOfGamePass(mainline, playedIndex, passes));
  return passes;
}

function normalizeSan(san: string): string {
  return san
    .replace(/[+#!?]+$/, "")
    .replace(/^0-0-0$/, "O-O-O")
    .replace(/^0-0$/, "O-O");
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
      const matches = tokens.every(
        (token, offset) =>
          tokenMatches(token, pass.line, start + offset) &&
          (!strictHints ||
            token.plyHint === null ||
            token.plyHint === pass.line.startPly + start + offset + 1)
      );
      if (matches) return { pass, start };
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
        slice.forEach((token, offset) =>
          out.set(token.index, resolvedAt(found.pass, found.start + offset))
        );
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
    else if (segment.kind === "square" || !/^\s*$/.test(segment.text)) flush();
  }
  flush();
  return out;
}

/**
 * The reviewed move commentary should anchor to for `nodeId`: the node's own review, or — on an
 * unreviewed variation — the nearest reviewed move it hangs off. `variation` is true in the latter
 * case. (A coach's line clicked is a scratch line: the game stays on the move it was clicked from.)
 */
export function reviewAnchorFor(
  moveTree: readonly MoveNode[],
  nodeId: string,
  reviewByNodeId: ReadonlyMap<string, MoveReview>
): { move: MoveReview; variation: boolean } | null {
  const own = reviewByNodeId.get(nodeId);
  if (own) return { move: own, variation: false };
  const byId = new Map(moveTree.map((node) => [node.id, node]));
  if (mainlineIds(moveTree, byId).has(nodeId)) return null;
  for (const ancestorId of ancestorIds(byId, nodeId)) {
    const review = reviewByNodeId.get(ancestorId);
    if (review) return { move: review, variation: true };
  }
  return null;
}

/** The main line's node ids, from the root. */
function mainlineIds(
  moveTree: readonly MoveNode[],
  byId: ReadonlyMap<string, MoveNode>
): Set<string> {
  const root = moveTree.find((node) => node.parentId === null);
  const mainline = new Set<string>();
  for (
    let cursor = root;
    cursor && !mainline.has(cursor.id);
    cursor = byId.get(cursor.children[0] ?? "")
  )
    mainline.add(cursor.id);
  return mainline;
}

/** `nodeId`'s ancestors, its parent first. */
function ancestorIds(byId: ReadonlyMap<string, MoveNode>, nodeId: string): string[] {
  const ancestors: string[] = [];
  const seen = new Set<string>();
  for (
    let cursor = byId.get(nodeId);
    cursor?.parentId && !seen.has(cursor.id);
    cursor = byId.get(cursor.parentId)
  ) {
    seen.add(cursor.id);
    ancestors.push(cursor.parentId);
  }
  return ancestors;
}
