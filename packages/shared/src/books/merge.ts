/**
 * One book chapter's pages of lines (llm-output.ts) merged into one repertoire tree. Every line
 * is written in full from move 1, so lines repeat their start and the tree grows where they part;
 * each move is checked with chessops. A line with an illegal move keeps its legal start and is
 * reported (`failures`, for repair). Moves link to the page that first printed them
 * (`[%page N]`, book-page.ts), notes become comments, annotation symbols NAGs, and the line's
 * role becomes the edge of its moves (see `edgeOf`).
 */
import { Chess } from "chessops/chess";
import { makeFen } from "chessops/fen";
import { makeSanAndPlay, parseSan } from "chessops/san";
import { makeSquare, makeUci, squareFile, squareRank } from "chessops/util";
import type { Move, NormalMove, Role } from "chessops/types";
import { positionFromFen, START_FEN } from "../chess/position";
import type { MoveNode } from "../types/chess";
import type { BookChapterReport, BookLineProblem } from "../types/books";
import {
  REPERTOIRE_ROOT_NODE_ID,
  type RepertoireColor,
  type RepertoireEdgeKind,
  type RepertoireNodeMeta
} from "../types/repertoire";
import { withBookPage } from "./book-page";
import type { BookGame, BookLine, BookLineRole, BookPageLines } from "./llm-output";
import { symbolsToNags, tokenizeMovetext, type MoveToken } from "./movetext";

export type BookMergePage = {
  /** 0-based PDF page. */
  pageIndex: number;
  printedPage: number | null;
  lines: BookPageLines;
  /** The page as read, for the coverage count (optional). */
  ocrText?: string | null;
  /** The page's lines couldn't be read (reported). */
  unreadable?: boolean;
};

export type BookMergeInput = {
  /** The repertoire's side. */
  color: RepertoireColor;
  pages: readonly BookMergePage[];
  /** Longest comment kept (the chapter store's limit). */
  maxCommentLength?: number;
};

/** A line with an illegal move: where, and the position before it (for repair). */
export type BookLineFailure = BookLineProblem & {
  lineIndex: number;
  moves: string;
  /** The position before the failing move. */
  fenBefore: string;
  /** The failing move as printed. */
  token: string;
  repairAttempts: number;
};

export type BookMergeResult = {
  tree: MoveNode[];
  nodeMeta: Record<string, RepertoireNodeMeta>;
  report: BookChapterReport;
  failures: BookLineFailure[];
};

const DEFAULT_MAX_COMMENT = 20_000;
const ROLE_ORDER: Record<BookLineRole, number> = {
  "own-recommended": 0,
  opponent: 1,
  "own-alternative": 2
};

type WorkNode = {
  node: MoveNode;
  /** The PDF page whose line added it. */
  pageIndex: number | null;
  /** Every page whose lines pass through it (coverage). */
  pages: Set<number>;
  roles: Set<BookLineRole>;
  inMainLine: boolean;
  game: string | null;
  notes: string[];
  nags: string[];
  order: number;
};

type Builder = {
  byId: Map<string, WorkNode>;
  childByMove: Map<string, WorkNode>;
  nextId: number;
  stats: Omit<BookChapterReport, "illegalLines" | "coverage" | "unreadablePages" | "moves">;
  failures: BookLineFailure[];
};

type PathStep = { token: MoveToken; work: WorkNode };

function rootWork(): WorkNode {
  return {
    node: {
      id: REPERTOIRE_ROOT_NODE_ID,
      parentId: null,
      san: null,
      uci: null,
      fenBefore: START_FEN,
      fenAfter: START_FEN,
      ply: 0,
      nags: [],
      comment: null,
      clockAfter: null,
      arrows: [],
      highlights: [],
      children: []
    },
    pageIndex: null,
    pages: new Set(),
    roles: new Set(),
    inMainLine: true,
    game: null,
    notes: [],
    nags: [],
    order: 0
  };
}

/** "Game: White–Black, Event Year" */
function gameTitle(game: BookGame): string {
  const event = [game.event, game.year].filter(Boolean).join(" ");
  return `Game: ${game.white}–${game.black}${event ? `, ${event}` : ""}`;
}

/** Chebyshev distance a move covers (the nearer of two candidate pieces wins a tie). */
function distance(move: NormalMove): number {
  return Math.max(
    Math.abs(squareFile(move.from) - squareFile(move.to)),
    Math.abs(squareRank(move.from) - squareRank(move.to))
  );
}

/** How many of `tokens` stay legal after `move`. */
function legalRun(position: Chess, move: Move, tokens: readonly MoveToken[]): number {
  const probe = position.clone();
  probe.play(move);
  let count = 0;
  for (const token of tokens) {
    const next = parseSan(probe, token.san);
    if (!next) break;
    probe.play(next);
    count += 1;
  }
  return count;
}

const ROLES: Record<string, Role> = { K: "king", Q: "queen", R: "rook", B: "bishop", N: "knight" };

/**
 * The move a token stands for. A piece move printed without the origin it needs ("Rd3" with two
 * rooks able to go there) takes the piece after which more of the line stays legal; still a tie,
 * the nearest piece, counted as a guess.
 */
function resolveMove(
  position: Chess,
  tokens: readonly MoveToken[],
  index: number
): { move: Move; reading: "exact" | "disambiguated" | "guess" } | null {
  const san = tokens[index].san;
  const exact = parseSan(position, san);
  if (exact) return { move: exact, reading: "exact" };
  const printed = /^([KQRBN])x?([a-h][1-8])/.exec(san);
  if (!printed) return null;
  const role = ROLES[printed[1]];
  const target = printed[2];
  const candidates: NormalMove[] = [];
  for (const [from, targets] of position.allDests()) {
    if (position.board.get(from)?.role !== role) continue;
    for (const to of targets) if (makeSquare(to) === target) candidates.push({ from, to });
  }
  if (!candidates.length) return null;
  const rest = tokens.slice(index + 1);
  const runs = candidates.map((move) => ({ move, run: legalRun(position, move, rest) }));
  const best = Math.max(...runs.map((entry) => entry.run));
  const kept = runs
    .filter((entry) => entry.run === best)
    .sort((a, b) => distance(a.move) - distance(b.move));
  return { move: kept[0].move, reading: kept.length === 1 ? "disambiguated" : "guess" };
}

/** Castling as the king's two-square move (e1g1), as the chapter store keeps it. */
function storedUci(position: Chess, move: Move): string {
  if (!("from" in move)) return makeUci(move);
  const piece = position.board.get(move.from);
  const target = position.board.get(move.to);
  if (piece?.role === "king" && target?.role === "rook" && target.color === piece.color) {
    const file = move.to > move.from ? 6 : 2;
    return `${makeSquare(move.from)}${makeSquare(squareRank(move.from) * 8 + file)}`;
  }
  return makeUci(move);
}

/** "1. e4 c5 2. Nf3" (from the initial position). */
function formatPath(sans: readonly string[]): string {
  return (
    sans
      .map((san, ply) => (ply % 2 === 0 ? `${ply / 2 + 1}. ${san}` : san))
      .join(" ")
      .trim() || "the start"
  );
}

type LineContext = { page: BookMergePage; line: BookLine; lineIndex: number; game: string | null };

/** The child of `parent` playing `uci`, added when the tree doesn't have it yet. */
function childFor(
  builder: Builder,
  parent: WorkNode,
  played: { uci: string; san: string; fenAfter: string },
  context: LineContext
): { work: WorkNode; added: boolean } {
  const key = `${parent.node.id}\0${played.uci}`;
  const existing = builder.childByMove.get(key);
  if (existing) return { work: existing, added: false };
  const id = `n${builder.nextId++}`;
  const work: WorkNode = {
    node: {
      ...rootWork().node,
      id,
      parentId: parent.node.id,
      san: played.san,
      uci: played.uci,
      fenBefore: parent.node.fenAfter,
      fenAfter: played.fenAfter,
      ply: parent.node.ply + 1
    },
    pageIndex: context.page.pageIndex,
    pages: new Set(),
    roles: new Set(),
    inMainLine: false,
    game: null,
    notes: [],
    nags: [],
    order: builder.nextId
  };
  parent.node.children.push(id);
  builder.byId.set(id, work);
  builder.childByMove.set(key, work);
  return { work, added: true };
}

/** Plays a line into the tree; returns its path (up to an illegal move, which is reported). */
function playLine(builder: Builder, context: LineContext, tokens: MoveToken[]): PathStep[] {
  const { page, line, lineIndex } = context;
  const position = Chess.default();
  let parent = builder.byId.get(REPERTOIRE_ROOT_NODE_ID)!;
  const path: PathStep[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const resolved = resolveMove(position, tokens, index);
    if (!resolved) {
      const played = path.map((step) => step.work.node.san ?? "");
      builder.failures.push({
        pageIndex: page.pageIndex,
        printedPage: page.printedPage,
        label: line.label,
        error: `illegal or unreadable move "${token.raw}" after ${formatPath(played)}`,
        lineIndex,
        moves: line.moves,
        fenBefore: makeFen(position.toSetup()),
        token: token.raw,
        repairAttempts: line.repairAttempts ?? 0
      });
      break;
    }
    if (resolved.reading === "disambiguated") builder.stats.disambiguated += 1;
    if (resolved.reading === "guess") builder.stats.ambiguousGuesses += 1;
    const uci = storedUci(position, resolved.move);
    const san = makeSanAndPlay(position, resolved.move);
    const { work, added } = childFor(
      builder,
      parent,
      { uci, san, fenAfter: makeFen(position.toSetup()) },
      context
    );
    // A game's header goes on the first move its main line adds.
    if (added && line.kind === "main" && context.game) {
      work.game = context.game;
      context.game = null;
    }
    work.pages.add(page.pageIndex);
    work.roles.add(line.role);
    if (line.kind === "main") work.inMainLine = true;
    for (const nag of symbolsToNags(token.symbols))
      if (!work.nags.includes(nag)) work.nags.push(nag);
    path.push({ token, work });
    parent = work;
  }
  return path;
}

const bareSan = (san: string) => san.replace(/[+#]/g, "");

/** Attaches the line's notes to the moves they follow (counted in the report). */
function anchorNotes(builder: Builder, line: BookLine, path: readonly PathStep[]): void {
  for (const note of line.notes) {
    const wanted = tokenizeMovetext(note.after)[0] as MoveToken | undefined;
    const matches = (step: PathStep) =>
      wanted !== undefined &&
      (bareSan(step.token.san) === bareSan(wanted.san) ||
        bareSan(step.work.node.san ?? "") === bareSan(wanted.san)) &&
      (!wanted.numbered ||
        (step.token.number === wanted.number && step.token.black === wanted.black));
    const step = [...path].reverse().find(matches);
    if (!step) {
      builder.stats.notesUnanchored += 1;
      continue;
    }
    builder.stats.notesAnchored += 1;
    if (note.text && !step.work.notes.includes(note.text)) step.work.notes.push(note.text);
    for (const nag of symbolsToNags(note.symbols ?? wanted?.symbols)) {
      if (!step.work.nags.includes(nag)) step.work.nags.push(nag);
    }
  }
}

/**
 * The edge into a node: an opponent's move is `covered`; a move of the repertoire's side is
 * `reference` when only lines the author rejects play it, `included` otherwise.
 */
function edgeOf(work: WorkNode, color: RepertoireColor): RepertoireEdgeKind {
  const mover = work.node.ply % 2 === 1 ? "white" : "black";
  if (mover !== color) return "covered";
  return [...work.roles].every((role) => role === "own-alternative") ? "reference" : "included";
}

/** Main-line moves first, then by the best role through them, then as the book printed them. */
function childRank(work: WorkNode): [number, number, number] {
  const role = Math.min(...[...work.roles].map((value) => ROLE_ORDER[value]));
  return [work.inMainLine ? 0 : 1, role, work.order];
}

function compareRanks(a: WorkNode, b: WorkNode): number {
  const [x, y] = [childRank(a), childRank(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

function commentOf(work: WorkNode, parentPage: number | null, maxLength: number): string | null {
  const prose = [work.game, ...work.notes].filter(Boolean).join(" ");
  const page = work.pageIndex !== null && work.pageIndex !== parentPage ? work.pageIndex + 1 : null;
  return withBookPage(prose ? prose.slice(0, maxLength - 16) : null, page);
}

/** The moves printed on a page (after a move number, or right after such a move). */
const PRINTED_MOVES =
  /\b\d+\s*(?:\.\.\.|…|\.)?\s*((?:[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8]|[a-h][1-8](?:=[QRBN])?|[0O]-[0O](?:-[0O])?)[+#]?)(?:[!?±∓=+-]*\s+((?:[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8]|[a-h][1-8](?:=[QRBN])?|[0O]-[0O](?:-[0O])?)[+#]?))?/g;

const castlingSan = (san: string) =>
  san.replace(/^[0O]-[0O]-[0O]/, "O-O-O").replace(/^[0O]-[0O]/, "O-O");

/** Moves printed on the pages (by their text) found in the tree near the same page. */
function coverage(
  pages: readonly BookMergePage[],
  nodes: readonly WorkNode[]
): BookChapterReport["coverage"] {
  const read = pages.filter((page) => page.ocrText);
  if (!read.length) return null;
  const sansByPage = new Map<number, Set<string>>();
  for (const work of nodes) {
    for (const pageIndex of work.pages) {
      const sans = sansByPage.get(pageIndex) ?? new Set<string>();
      sans.add(bareSan(work.node.san ?? ""));
      sansByPage.set(pageIndex, sans);
    }
  }
  let printed = 0;
  let found = 0;
  for (const page of read) {
    const near = [page.pageIndex - 1, page.pageIndex, page.pageIndex + 1].flatMap((index) => [
      ...(sansByPage.get(index) ?? [])
    ]);
    const have = new Set(near);
    for (const match of (page.ocrText ?? "").matchAll(PRINTED_MOVES)) {
      for (const san of [match[1], match[2]]) {
        if (!san) continue;
        printed += 1;
        if (have.has(bareSan(castlingSan(san)))) found += 1;
      }
    }
  }
  return { printed, found };
}

/** The chapter's tree, edges and report (see the module comment). */
export function mergeBookChapter(input: BookMergeInput): BookMergeResult {
  const root = rootWork();
  const builder: Builder = {
    byId: new Map([[root.node.id, root]]),
    childByMove: new Map(),
    nextId: 1,
    stats: {
      lines: 0,
      legalLines: 0,
      repairedLines: 0,
      notesAnchored: 0,
      notesUnanchored: 0,
      disambiguated: 0,
      ambiguousGuesses: 0
    },
    failures: []
  };
  for (const page of input.pages) {
    const context = { game: page.lines.game ? gameTitle(page.lines.game) : null };
    page.lines.lines.forEach((line, lineIndex) => {
      const tokens = tokenizeMovetext(line.moves);
      if (!tokens.length) return;
      builder.stats.lines += 1;
      if (line.repairedFrom) builder.stats.repairedLines += 1;
      const failuresBefore = builder.failures.length;
      const lineContext: LineContext = { page, line, lineIndex, game: context.game };
      const path = playLine(builder, lineContext, tokens);
      context.game = lineContext.game;
      if (builder.failures.length === failuresBefore) builder.stats.legalLines += 1;
      anchorNotes(builder, line, path);
    });
  }
  return finish(builder, input);
}

function finish(builder: Builder, input: BookMergeInput): BookMergeResult {
  const maxLength = input.maxCommentLength ?? DEFAULT_MAX_COMMENT;
  const nodes = [...builder.byId.values()];
  const nodeMeta: Record<string, RepertoireNodeMeta> = {};
  for (const work of nodes) {
    const parent = work.node.parentId ? builder.byId.get(work.node.parentId) : undefined;
    work.node.children.sort((a, b) => compareRanks(builder.byId.get(a)!, builder.byId.get(b)!));
    if (!parent) continue;
    work.node.nags = work.nags;
    work.node.comment = commentOf(work, parent.pageIndex, maxLength);
    nodeMeta[work.node.id] = { edge: edgeOf(work, input.color) };
  }
  const illegalLines: BookLineProblem[] = builder.failures.map(
    ({ pageIndex, printedPage, label, error }) => ({ pageIndex, printedPage, label, error })
  );
  return {
    tree: nodes.map((work) => work.node),
    nodeMeta,
    report: {
      ...builder.stats,
      illegalLines,
      moves: nodes.length - 1,
      coverage: coverage(input.pages, nodes),
      unreadablePages: input.pages.filter((page) => page.unreadable).map((page) => page.pageIndex)
    },
    failures: builder.failures
  };
}

/** The legal moves in `fen`, in SAN, sorted (for the repair prompt). */
export function legalSans(fen: string): string[] {
  const position = positionFromFen(fen);
  const sans = new Set<string>();
  for (const [from, targets] of position.allDests()) {
    const pawn = position.board.get(from)?.role === "pawn";
    for (const to of targets) {
      const promotes = pawn && (squareRank(to) === 0 || squareRank(to) === 7);
      for (const promotion of promotes ? PROMOTIONS : [undefined]) {
        sans.add(makeSanAndPlay(position.clone(), { from, to, promotion }));
      }
    }
  }
  return [...sans].sort();
}

const PROMOTIONS: Role[] = ["queen", "rook", "bishop", "knight"];
