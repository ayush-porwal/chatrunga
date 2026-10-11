import { nanoid } from "nanoid";
import { parseComment, parsePgn, startingPosition } from "chessops/pgn";
import type { ChildNode, PgnNodeData } from "chessops/pgn";
import { makeFen } from "chessops/fen";
import { makeSanAndPlay } from "chessops/san";
import { makeUci, parseUci } from "chessops/util";
import { parseAnnotationComment, serializeAnnotationComment } from "./annotations";
import { applySan, positionFromFen, START_FEN } from "./position";
import type { Color, GameHeaders, GameSession, ImportedGame, MoveNode } from "../types/chess";
import {
  ERROR_MARKS,
  type EngineScore,
  type GameOpening,
  type MoveAnnotation,
  type MoveAssessment,
  type MoveReview
} from "../types/engine";

const ROOT_ID = "root";

export function createEmptyGame(): GameSession {
  const root = createRootNode(START_FEN);
  return {
    id: null,
    source: "new",
    headers: { result: "*" },
    rootFen: START_FEN,
    currentFen: START_FEN,
    currentNodeId: ROOT_ID,
    moveTree: [root],
    pgn: "*"
  };
}

export function createGameFromFen(input: {
  fen: string;
  source?: GameSession["source"];
  headers?: GameHeaders;
}): GameSession {
  const root = createRootNode(input.fen);
  return {
    id: null,
    source: input.source ?? "new",
    headers: { result: "*", ...input.headers },
    rootFen: input.fen,
    currentFen: input.fen,
    currentNodeId: ROOT_ID,
    moveTree: [root],
    pgn: headersToPgn({ result: "*", ...input.headers }, input.fen)
      .concat(["", "*"])
      .join("\n")
  };
}

/**
 * `strict` refuses a game with a move that can't be played (rather than dropping that move and
 * everything after it), for restoring a stored game where a shorter tree would lose moves.
 */
export function importPgnText(
  pgn: string,
  { strict = false }: { strict?: boolean } = {}
): ImportedGame {
  const games = parsePgn(pgn);
  if (!games.length) throw new Error("No PGN game found");

  const game = games[0];
  const starting = startingPosition(game.headers).unwrap();
  const rootFen = makeFen(starting.toSetup());
  const headers = headersFromMap(game.headers);
  const root = createRootNode(rootFen);
  const moveTree: MoveNode[] = [root];

  const byId = new Map<string, MoveNode>([[ROOT_ID, root]]);
  for (const child of game.moves.children) appendPgnChild({ moveTree, byId, strict }, root, child);

  // Imported games open on the last mainline move.
  let current = root;
  for (let nextId = current.children[0]; nextId; nextId = current.children[0]) {
    const next = byId.get(nextId);
    if (!next) break;
    current = next;
  }
  const currentNodeId = current.id;
  const currentNode = current;
  return {
    game: {
      id: null,
      source: "pgn-import",
      headers,
      rootFen,
      currentFen: currentNode.fenAfter,
      currentNodeId,
      moveTree,
      pgn: exportGameToPgn({ headers, moveTree })
    },
    warning: games.length > 1 ? "Imported the first PGN game only." : undefined
  };
}

/** A reviewed move as {@link exportGameToPgn} writes it: its mark, its eval and the engine's best line. */
export type PgnAnalysisMove = Pick<
  MoveReview,
  "nodeId" | "fenBefore" | "evalAfter" | "bestEvalAfter" | "bestMove" | "bestLine"
> & { assessment?: Pick<MoveAssessment, "annotation"> };

/** A review of the game's main line, for the PGN to carry (see {@link exportGameToPgn}). */
export type PgnAnalysis = {
  moves: readonly PgnAnalysisMove[];
  /** The opening the review named; written as ECO / Opening when the game's headers have neither. */
  opening?: Pick<GameOpening, "eco" | "name"> | null;
};

/**
 * The game as PGN: every line of the move tree with its comments, arrows and clocks. With
 * `analysis` it also carries the review: each mark with a standard NAG as that NAG (in place of
 * any move-quality NAG the move had), each eval after a move as `[%eval …]` (White's view), the
 * opening in the headers, and the engine's best line under each marked error as a variation
 * (merged into the moves already there, so a line explored by hand isn't written twice).
 */
export function exportGameToPgn(input: {
  headers: GameHeaders;
  moveTree: MoveNode[];
  analysis?: PgnAnalysis | null;
}): string {
  const root = input.moveTree.find((node) => node.id === ROOT_ID);
  const analysis = input.analysis;
  const headers =
    analysis?.opening && !input.headers.eco && !input.headers.opening
      ? { ...input.headers, eco: analysis.opening.eco, opening: analysis.opening.name }
      : input.headers;
  const lines = headersToPgn(headers, root?.fenBefore);
  const body = serializeMoveTreeMoves(
    analysis?.moves.length ? withAnalysis(input.moveTree, analysis.moves) : input.moveTree
  );
  const result = input.headers.result || "*";
  lines.push("");
  lines.push(`${body ? `${body} ` : ""}${result}`.trim());
  return lines.join("\n");
}

/** The review marks with a standard NAG; Excellent, Good, Miss and Book have none (see annotationGlyph). */
const ANNOTATION_NAGS: Partial<Record<MoveAnnotation, string>> = {
  brilliant: "$3",
  great: "$1",
  inaccuracy: "$6",
  mistake: "$2",
  blunder: "$4"
};

/** NAGs $1–$6: how good the move was (!, ?, !!, ??, !?, ?!), of which a move carries one. */
const MOVE_QUALITY_NAGS = new Set(["$1", "$2", "$3", "$4", "$5", "$6"]);

const EVAL_TAG = /\[%eval\s[^\]]*\]/gi;

/**
 * A copy of `moveTree` with the review written onto its moves: marks as NAGs and evals in the
 * comments, and each marked error's best line merged in from the position before it.
 */
function withAnalysis(
  moveTree: readonly MoveNode[],
  moves: readonly PgnAnalysisMove[]
): MoveNode[] {
  const byId = new Map(
    moveTree.map((node) => [node.id, { ...node, children: [...node.children] }])
  );
  const evals = new Map<string, string>();
  for (const move of moves) {
    const node = byId.get(move.nodeId);
    if (!node) continue;
    const annotation = move.assessment?.annotation ?? null;
    if (annotation) node.nags = withReviewMark(node.nags, annotation);
    const evaluation = pgnEval(move.evalAfter);
    if (evaluation) evals.set(node.id, evaluation);

    if (!annotation || !ERROR_MARKS.has(annotation)) continue;
    const first = mergeBestLine(byId, node, move);
    const bestEval = pgnEval(move.bestEvalAfter);
    if (first && bestEval && !evals.has(first.id)) evals.set(first.id, bestEval);
  }
  for (const [id, evaluation] of evals) {
    const node = byId.get(id);
    if (node) node.comment = withEvalTag(node.comment, evaluation);
  }
  return [...byId.values()];
}

/**
 * The review's mark replaces any quality NAG the move brought, also when the mark has no standard
 * glyph (excellent, good, miss, book): the PGN never contradicts the review.
 */
function withReviewMark(nags: readonly string[], annotation: MoveAnnotation): string[] {
  const nag = ANNOTATION_NAGS[annotation];
  const kept = nags.filter((item) => !MOVE_QUALITY_NAGS.has(item));
  return nag ? [nag, ...kept] : kept;
}

/**
 * Merges a marked error's best line in from the position before it (see `mergeLine`); null when
 * the review's position isn't the move's parent or nothing was added.
 */
function mergeBestLine(
  byId: Map<string, MoveNode>,
  node: MoveNode,
  move: PgnAnalysisMove
): MoveNode | null {
  const parent = node.parentId ? byId.get(node.parentId) : undefined;
  if (parent?.fenAfter !== move.fenBefore) return null;
  const best = move.bestLine.length ? move.bestLine : move.bestMove ? [move.bestMove] : [];
  return mergeLine(byId, parent, best, node);
}

/**
 * The comment with the review's eval, which replaces one the move brought along (an imported
 * Lichess analysis).
 */
function withEvalTag(comment: string | null, evaluation: string): string {
  const text = comment?.replace(EVAL_TAG, "").replace(/\s+/g, " ").trim();
  return text ? `${text} [%eval ${evaluation}]` : `[%eval ${evaluation}]`;
}

/**
 * Walks `line` (UCI) from `parent`, following the moves the tree already has and adding the rest
 * after them (so it reads as a variation), up to the first move that can't be played. Returns the
 * line's first move, or null (nothing added) when there is none or it is `played`: a best line
 * starting with the move played is the game itself.
 */
function mergeLine(
  byId: Map<string, MoveNode>,
  parent: MoveNode,
  line: readonly string[],
  played: MoveNode
): MoveNode | null {
  const position = positionFromFen(parent.fenAfter);
  let first: MoveNode | null = null;
  let at = parent;
  for (const [index, uci] of line.entries()) {
    const move = parseUci(uci);
    if (!move || !position.isLegal(move)) break;
    const fenBefore = makeFen(position.toSetup());
    const san = makeSanAndPlay(position, move);
    let next = at.children.map((id) => byId.get(id)).find((child) => child?.san === san);
    if (!first && next === played) return null;
    if (!next) {
      // Unique in the tree even if a node already has the id (a game imported with such ids).
      let id = `${played.id}~best-${index}`;
      for (let suffix = 1; byId.has(id); suffix++) id = `${played.id}~best-${index}-${suffix}`;
      next = {
        id,
        parentId: at.id,
        san,
        uci: makeUci(move),
        fenBefore,
        fenAfter: makeFen(position.toSetup()),
        ply: at.ply + 1,
        nags: [],
        comment: null,
        clockAfter: null,
        arrows: [],
        highlights: [],
        children: []
      };
      byId.set(next.id, next);
      at.children.push(next.id);
    }
    first ??= next;
    at = next;
  }
  return first;
}

/**
 * A `[%eval]` value: pawns with two decimals, `#N` / `#-N` for a mate, from White's view. None for
 * a checkmate (`mate 0`): the result says it.
 */
function pgnEval(score: EngineScore | null | undefined): string | null {
  if (!score) return null;
  if (score.type === "mate") return score.value ? `#${score.value}` : null;
  return (score.value / 100).toFixed(2);
}

export function addMoveNode(
  moveTree: MoveNode[],
  parentId: string,
  {
    san,
    uci,
    fenBefore,
    fenAfter
  }: { san: string; uci: string; fenBefore: string; fenAfter: string }
): { moveTree: MoveNode[]; node: MoveNode } {
  const existing = moveTree.find((node) => node.parentId === parentId && node.uci === uci);
  if (existing) return { moveTree, node: existing };

  const parent = moveTree.find((node) => node.id === parentId);
  if (!parent) throw new Error("Parent node not found");

  const node: MoveNode = {
    id: nanoid(),
    parentId,
    san,
    uci,
    fenBefore,
    fenAfter,
    ply: parent.ply + 1,
    nags: [],
    comment: null,
    clockAfter: null,
    arrows: [],
    highlights: [],
    children: []
  };

  return {
    moveTree: moveTree
      .map((item) =>
        item.id === parentId ? { ...item, children: [...item.children, node.id] } : item
      )
      .concat(node),
    node
  };
}

/** Lichess / chessops clock parsing ([%clk …] as seconds), with regex fallback. */
function clockAfterFromCommentBlob(blob: string, regexFallback: string | null): string | null {
  const raw = blob.replace(/\uFF05/g, "%").trim();
  if (!raw) return regexFallback;
  const parsed = parseComment(raw);
  if (parsed.clock !== undefined) return formatSecondsAsClk(parsed.clock);
  return regexFallback;
}

/** Matches chessops `makeClk` display (hours:mins:secs with optional fraction). */
function formatSecondsAsClk(seconds: number): string {
  let s = Math.max(0, seconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  s = (s % 3600) % 60;
  return `${hours}:${minutes.toString().padStart(2, "0")}:${s.toLocaleString("en", {
    minimumIntegerDigits: 2,
    maximumFractionDigits: 3
  })}`;
}

/** The tree an import is writing, and whether an unplayable move fails it (see importPgnText). */
type PgnTreeBuilder = { moveTree: MoveNode[]; byId: Map<string, MoveNode>; strict: boolean };

function appendPgnChild(
  builder: PgnTreeBuilder,
  parent: MoveNode,
  child: ChildNode<PgnNodeData>
): void {
  const { moveTree, byId, strict } = builder;
  const fenBefore = parent.fenAfter;
  const applied = applySan(fenBefore, child.data.san);
  if (!applied) {
    if (strict) throw new Error(`Illegal move in PGN: ${child.data.san}`);
    return;
  }
  const comments = [...(child.data.startingComments ?? []), ...(child.data.comments ?? [])];
  const commentBlob = comments.join(" ");
  const annotation = parseAnnotationComment(commentBlob);
  const node: MoveNode = {
    id: nanoid(),
    parentId: parent.id,
    san: applied.san,
    uci: applied.uci,
    fenBefore,
    fenAfter: applied.fen,
    ply: parent.ply + 1,
    nags: (child.data.nags ?? []).map((nag) => `$${nag}`),
    comment: annotation.text,
    clockAfter: clockAfterFromCommentBlob(commentBlob, annotation.clock),
    arrows: annotation.arrows,
    highlights: annotation.highlights,
    children: []
  };

  parent.children.push(node.id);
  moveTree.push(node);
  byId.set(node.id, node);

  for (const grandChild of child.children) appendPgnChild(builder, node, grandChild);
}

/**
 * PGN movetext of a move tree (no headers, root comment or result): the main line with each
 * alternative in parentheses, numbered from the root's real ply.
 */
export function serializeMoveTreeMoves(moveTree: readonly MoveNode[]): string {
  const byId = indexMoveTree(moveTree);
  const root = byId.get(ROOT_ID);
  return root ? serializeChildren(byId, root) : "";
}

function indexMoveTree(moveTree: readonly MoveNode[]): Map<string, MoveNode> {
  return new Map(moveTree.map((node) => [node.id, node]));
}

/**
 * Writes the moves after `parent`: its main continuation, with each alternative to a move in
 * parentheses right after that move (`1. e4 e5 (1... c5) 2. Nf3`). Move numbers and the mover come
 * from the ply, which counts from the game's real start (see `rootPly`).
 */
function serializeChildren(
  byId: ReadonlyMap<string, MoveNode>,
  parent: MoveNode,
  needsNumber = true
): string {
  const parts: string[] = [];
  // Ends at the first node without a main move (the `break` below).
  for (let from: MoveNode = parent; ; ) {
    const [mainId, ...alternativeIds]: string[] = from.children;
    const main: MoveNode | undefined = mainId ? byId.get(mainId) : undefined;
    if (!main?.san) break;
    pushMove(parts, main, needsNumber);
    needsNumber = false;
    for (const alternativeId of alternativeIds) {
      const alternative = byId.get(alternativeId);
      if (!alternative?.san) continue;
      const line: string[] = [];
      pushMove(line, alternative, true);
      const rest = serializeChildren(byId, alternative, false);
      if (rest) line.push(rest);
      parts.push(`(${line.join(" ")})`);
      // After a variation, Black's reply needs its number again (`2. Nf3 (2. d4) 2... Nc6`).
      needsNumber = true;
    }
    from = main;
  }
  return parts.join(" ");
}

function pushMove(parts: string[], node: MoveNode, needsNumber: boolean): void {
  const moveNumber = Math.ceil(node.ply / 2);
  if (node.ply % 2 === 1) parts.push(`${moveNumber}.`);
  else if (needsNumber) parts.push(`${moveNumber}...`);
  parts.push(node.san ?? "");
  if (node.nags.length) parts.push(...node.nags);
  const comment = serializeAnnotationComment(
    node.comment,
    node.arrows,
    node.highlights,
    node.clockAfter
  );
  if (comment) parts.push(`{ ${comment} }`);
}

function headersFromMap(headers: Map<string, string>): GameHeaders {
  const get = (key: string) => headers.get(key) ?? null;
  return {
    event: get("Event"),
    site: get("Site"),
    date: get("Date"),
    round: get("Round"),
    white: get("White"),
    black: get("Black"),
    whiteElo: get("WhiteElo"),
    blackElo: get("BlackElo"),
    timeControl: get("TimeControl"),
    eco: get("ECO"),
    opening: get("Opening"),
    utcDate: get("UTCDate"),
    utcTime: get("UTCTime"),
    termination: get("Termination"),
    result: get("Result") ?? "*",
    orientationHint: parseOrientationHint(get("Orientation"))
  };
}

function parseOrientationHint(raw: string | null): Color | null {
  if (!raw?.trim()) return null;
  const v = raw.trim().toLowerCase();
  if (v === "black") return "black";
  if (v === "white") return "white";
  return null;
}

/**
 * The tags a game's PGN carries, in the order they're written: each with the header it comes from
 * and the value written when that is empty (null: the tag is left out).
 */
type PgnTag = readonly [tag: string, header: keyof GameHeaders, fallback: string | null];
const PGN_TAGS: readonly PgnTag[] = [
  ["Event", "event", "?"],
  ["Site", "site", "?"],
  ["Date", "date", "????.??.??"],
  ["Round", "round", "?"],
  ["White", "white", "White"],
  ["WhiteElo", "whiteElo", null],
  ["Black", "black", "Black"],
  ["BlackElo", "blackElo", null],
  ["TimeControl", "timeControl", null],
  ["ECO", "eco", null],
  ["Opening", "opening", null],
  ["UTCDate", "utcDate", null],
  ["UTCTime", "utcTime", null],
  ["Termination", "termination", null],
  ["Orientation", "orientationHint", null],
  ["Result", "result", "*"]
];

function headersToPgn(headers: GameHeaders, rootFen?: string): string[] {
  const lines: string[] = [];
  for (const [tag, header, fallback] of PGN_TAGS) {
    const value = headers[header] || fallback;
    if (value) lines.push(`[${tag} "${escapeHeader(value)}"]`);
  }
  if (rootFen && rootFen !== START_FEN) {
    lines.push('[SetUp "1"]');
    lines.push(`[FEN "${escapeHeader(rootFen)}"]`);
  }
  return lines;
}

/** Escapes a PGN tag value (backslashes and double quotes). */
export function escapeHeader(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Plies played before `fen` (the start position is 0), so a move's ply keeps its real number and
 * parity: an odd ply is White's move, and its move number is `ceil(ply / 2)`.
 */
export function rootPly(fen: string): number {
  const [, turn, , , , fullmoveField] = fen.trim().split(/\s+/);
  const fullmove = Number(fullmoveField);
  const moves = Number.isInteger(fullmove) && fullmove > 0 ? fullmove - 1 : 0;
  return moves * 2 + (turn === "b" ? 1 : 0);
}

/**
 * Games saved before plies counted from the real start have a root at ply 0 even when the root
 * position is, say, Black to move at move 42. Shift such a tree so numbering and movers are right.
 */
export function withRealPlies(moveTree: MoveNode[]): MoveNode[] {
  const shift = legacyPlyShift(moveTree);
  return shift ? moveTree.map((node) => ({ ...node, ply: node.ply + shift })) : moveTree;
}

/** How far `withRealPlies` moves this tree's plies (0 for trees that already count from the real start). */
export function legacyPlyShift(moveTree: readonly MoveNode[]): number {
  const root = moveTree.find((node) => node.id === ROOT_ID);
  return root ? rootPly(root.fenBefore) - root.ply : 0;
}

function createRootNode(fen: string): MoveNode {
  return {
    id: ROOT_ID,
    parentId: null,
    san: null,
    uci: null,
    fenBefore: fen,
    fenAfter: fen,
    ply: rootPly(fen),
    nags: [],
    comment: null,
    clockAfter: null,
    arrows: [],
    highlights: [],
    children: []
  };
}

/** Latest remaining times on the path from root to `nodeId`, from `[%clk]` on each move. */
export function clocksOnPathToNode(
  moveTree: MoveNode[],
  nodeId: string
): {
  white: string | null;
  black: string | null;
} {
  const byId = indexMoveTree(moveTree);
  const path: MoveNode[] = [];
  let id: string | null = nodeId;
  while (id) {
    const node = byId.get(id);
    if (!node) break;
    path.push(node);
    id = node.parentId;
  }
  path.reverse();

  let white: string | null = null;
  let black: string | null = null;
  for (const node of path) {
    if (node.id === ROOT_ID) continue;
    const c = node.clockAfter ?? null;
    if (!c) continue;
    if (node.ply % 2 === 1) white = c;
    else black = c;
  }
  return { white, black };
}

/** Resolve which move node matches the saved board (best-effort when only FEN is persisted). */
export function nodeIdForBoardFen(moveTree: MoveNode[], fen: string, fallbackId: string): string {
  const matches = moveTree.filter((n) => n.fenAfter === fen);
  if (!matches.length) return fallbackId;
  return matches.reduce((a, b) => (a.ply >= b.ply ? a : b)).id;
}
