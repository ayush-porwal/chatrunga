/**
 * Repertoire PGN interoperability (design §10): every game of an import becomes a candidate
 * chapter with all of its tags, annotations and variations; export writes one game per chapter.
 */
import { emptyHeaders, parsePgn, startingPosition } from "chessops/pgn";
import type { ChildNode, Game, PgnNodeData } from "chessops/pgn";
import { makeFen } from "chessops/fen";
import type { MoveNode } from "../types/chess";
import { REPERTOIRE_ROOT_NODE_ID, type ImportInvalidBranch } from "../types/repertoire";
import { parseAnnotationComment, serializeAnnotationComment } from "./annotations";
import { escapeHeader, rootPly, serializeMoveTreeMoves } from "./pgn";
import { applySan, START_FEN } from "./position";

export type RepertoirePgnLimits = {
  /** Most games one import may hold. */
  maxGames?: number;
  /** Most moves (tree nodes, roots excluded) across all games. */
  maxNodes?: number;
  /** Deepest line, in moves from a game's root. */
  maxDepth?: number;
  /**
   * Longest comment (a move's or a game's), measured as stored: after `[%cal]`, `[%csl]` and
   * `[%clk]` tags are read out of it. A longer comment rejects only its game.
   */
  maxCommentLength?: number;
};

export type ParsedRepertoireGame = {
  /** Position of the game in the input (0-based), counting rejected games too. */
  index: number;
  proposedTitle: string;
  rootFen: string;
  /** Every tag of the game as written (unknown tags too). */
  headers: Record<string, string>;
  /**
   * Root id `"root"`; moves get ids `n1`, `n2`, … depth-first (main line before its
   * alternatives), so parsing the same text always yields the same ids.
   */
  tree: MoveNode[];
  /** Moves in the tree (the root excluded). */
  nodeCount: number;
  warnings: string[];
  /** Branches that couldn't be replayed; each was left out of `tree` with everything after it. */
  invalidBranches: ImportInvalidBranch[];
  /**
   * Why the whole game can't be imported (unsupported variant, bad FEN, a comment over the limit);
   * its tree is empty.
   */
  rejected: string | null;
};

export type ParsedRepertoirePgn = { games: ParsedRepertoireGame[] };

const SUPPORTED_VARIANTS = new Set(["standard", "chess", "from position"]);

/**
 * Parses every game of `pgn`. Illegal moves are reported in `invalidBranches` (with the exact
 * path) instead of being dropped silently; games in other variants are rejected with a reason.
 * Throws when the input has no game or exceeds a limit.
 */
export function parseRepertoirePgn(
  pgn: string,
  limits: RepertoirePgnLimits = {}
): ParsedRepertoirePgn {
  const reader = createRepertoirePgnReader(limits);
  for (const game of parsePgn(pgn, emptyHeaders)) reader.push(game);
  return reader.finish();
}

/** Parses games one at a time, keeping the limits across all of them (see `parseRepertoirePgn`). */
export type RepertoirePgnReader = {
  /**
   * Adds the next game of the input; empty games (no tags, moves or comments) are skipped and
   * give null. Throws the actionable limit error as soon as a limit is exceeded.
   */
  push(game: Game<PgnNodeData>): ParsedRepertoireGame | null;
  /** Every game pushed so far; throws when there was none. */
  finish(): ParsedRepertoirePgn;
  /** Games kept so far (empty ones excluded). */
  readonly gamesSeen: number;
  /** Moves kept so far across all games. */
  readonly nodesSeen: number;
};

/** An incremental `parseRepertoirePgn`: same ids, warnings, limits and messages, one game at a time. */
export function createRepertoirePgnReader({
  maxGames = 1000,
  maxNodes = 100_000,
  maxDepth = 128,
  maxCommentLength = 20_000
}: RepertoirePgnLimits = {}): RepertoirePgnReader {
  const budget = { nodes: 0, maxNodes, maxDepth, maxCommentLength };
  const games: ParsedRepertoireGame[] = [];
  return {
    push(game) {
      if (!game.headers.size && !game.moves.children.length && !game.comments?.length) return null;
      if (games.length >= maxGames) {
        throw new Error(
          `This PGN has more than ${maxGames} games; one import can hold at most ${maxGames}. ` +
            "Split the file and import it in parts."
        );
      }
      const parsed = parseGame(game, games.length, budget);
      games.push(parsed);
      return parsed;
    },
    finish() {
      if (!games.length) throw new Error("No PGN game found.");
      return { games };
    },
    get gamesSeen() {
      return games.length;
    },
    get nodesSeen() {
      return budget.nodes;
    }
  };
}

type Budget = { nodes: number; maxNodes: number; maxDepth: number; maxCommentLength: number };

function parseGame(game: Game<PgnNodeData>, index: number, budget: Budget): ParsedRepertoireGame {
  const headers = Object.fromEntries(game.headers);
  const proposedTitle = titleFromHeaders(headers, index);
  const rejectedGame = (reason: string): ParsedRepertoireGame => ({
    index,
    proposedTitle,
    rootFen: START_FEN,
    headers,
    tree: [rootNode(START_FEN)],
    nodeCount: 0,
    warnings: [reason],
    invalidBranches: [],
    rejected: reason
  });

  const variant = headers.Variant?.trim();
  if (variant && !SUPPORTED_VARIANTS.has(variant.toLowerCase())) {
    return rejectedGame(`Unsupported variant "${variant}": only standard chess can be imported.`);
  }
  const starting = startingPosition(game.headers);
  if (starting.isErr) {
    return rejectedGame(`Invalid starting position (FEN tag): ${starting.error.message}.`);
  }

  const rootFen = makeFen(starting.value.toSetup());
  const root = rootNode(rootFen);
  const builder: TreeBuilder = {
    tree: [root],
    byId: new Map([[root.id, root]]),
    nextId: 1,
    warnings: [],
    invalidBranches: [],
    budget
  };
  // A comment over the limit rejects this game only; its moves no longer count toward the limit.
  const nodesBefore = budget.nodes;
  try {
    const rootAnnotation = checkedAnnotation((game.comments ?? []).join(" "), budget, []);
    root.comment = rootAnnotation.text;
    root.arrows = rootAnnotation.arrows;
    root.highlights = rootAnnotation.highlights;
    for (const child of game.moves.children) appendMove(builder, root, [], child, 1);
  } catch (error) {
    // The move limit can be reached before this game's over-long comment is read: the comment
    // still rejects the game alone (its moves don't count), rather than failing the import.
    const tooLong =
      error instanceof CommentTooLongError
        ? error
        : error instanceof MoveBudgetError
          ? firstLongComment(game, root.ply, budget)
          : null;
    if (!tooLong) throw error;
    budget.nodes = nodesBefore;
    return rejectedGame(tooLong.message);
  }

  return {
    index,
    proposedTitle,
    rootFen,
    headers,
    tree: builder.tree,
    nodeCount: builder.tree.length - 1,
    warnings: builder.warnings,
    invalidBranches: builder.invalidBranches,
    rejected: null
  };
}

/** A comment longer than the limit; its game is rejected with this message. */
class CommentTooLongError extends Error {}

/** The import has more moves than its limit. */
class MoveBudgetError extends Error {}

/**
 * The error for the first comment of `game` (its root at `rootPly`) over the length limit, or
 * null when there is none. Reads the parsed game only; nothing is built.
 */
function firstLongComment(
  game: Game<PgnNodeData>,
  rootPly: number,
  budget: Budget
): CommentTooLongError | null {
  try {
    checkedAnnotation((game.comments ?? []).join(" "), budget, []);
    type Item = { node: ChildNode<PgnNodeData>; path: Pick<MoveNode, "ply" | "san">[] };
    const pending: Item[] = [...game.moves.children].reverse().map((node) => ({ node, path: [] }));
    for (let item = pending.pop(); item; item = pending.pop()) {
      const { node, path } = item;
      const here = [...path, { ply: rootPly + path.length + 1, san: node.data.san }];
      const comments = [...(node.data.startingComments ?? []), ...(node.data.comments ?? [])];
      checkedAnnotation(comments.join(" "), budget, here);
      for (let i = node.children.length - 1; i >= 0; i--) {
        pending.push({ node: node.children[i], path: here });
      }
    }
    return null;
  } catch (error) {
    if (error instanceof CommentTooLongError) return error;
    throw error;
  }
}

/**
 * The comment's annotation; throws CommentTooLongError when its text, with the annotation tags
 * read out, is longer than the limit.
 */
function checkedAnnotation(
  comment: string,
  budget: Budget,
  path: readonly Pick<MoveNode, "ply" | "san">[]
): ReturnType<typeof parseAnnotationComment> {
  const annotation = parseAnnotationComment(comment);
  if ((annotation.text?.length ?? 0) > budget.maxCommentLength) {
    throw new CommentTooLongError(
      `a comment is longer than ${budget.maxCommentLength} characters ` +
        `(at ${formatPath(path) || "the start"})`
    );
  }
  return annotation;
}

type TreeBuilder = {
  tree: MoveNode[];
  byId: Map<string, MoveNode>;
  nextId: number;
  warnings: string[];
  invalidBranches: ImportInvalidBranch[];
  budget: Budget;
};

function appendMove(
  builder: TreeBuilder,
  parent: MoveNode,
  path: MoveNode[],
  child: ChildNode<PgnNodeData>,
  depth: number
): void {
  const { budget } = builder;
  if (depth > budget.maxDepth) {
    throw new Error(
      `A line is longer than ${budget.maxDepth} moves (at ${formatPath(path) || "the start"}). ` +
        "Repertoire chapters hold opening lines; trim the game before importing it."
    );
  }

  const applied = applySan(parent.fenAfter, child.data.san);
  if (!applied) {
    builder.invalidBranches.push({
      path: formatPath(path),
      san: child.data.san,
      reason: "Not a legal move in this position; the move and everything after it are excluded."
    });
    return;
  }

  // The same move written twice from one position (a duplicated variation) continues one node.
  const sibling = parent.children
    .map((id) => builder.byId.get(id)!)
    .find((node) => node.uci === applied.uci);
  let node: MoveNode;
  if (sibling) {
    builder.warnings.push(
      `Duplicate variation ${formatPath([...path, sibling])} was merged into the first one.`
    );
    node = sibling;
  } else {
    if (++budget.nodes > budget.maxNodes) {
      throw new MoveBudgetError(
        `This PGN has more than ${budget.maxNodes} moves; split it and import it in parts.`
      );
    }
    const annotation = checkedAnnotation(
      [...(child.data.startingComments ?? []), ...(child.data.comments ?? [])].join(" "),
      budget,
      [...path, { ply: parent.ply + 1, san: applied.san }]
    );
    node = {
      id: `n${builder.nextId++}`,
      parentId: parent.id,
      san: applied.san,
      uci: applied.uci,
      fenBefore: parent.fenAfter,
      fenAfter: applied.fen,
      ply: parent.ply + 1,
      nags: (child.data.nags ?? []).map((nag) => `$${nag}`),
      comment: annotation.text,
      clockAfter: annotation.clock,
      arrows: annotation.arrows,
      highlights: annotation.highlights,
      children: []
    };
    parent.children.push(node.id);
    builder.tree.push(node);
    builder.byId.set(node.id, node);
  }

  const nextPath = [...path, node];
  for (const grandChild of child.children) {
    appendMove(builder, node, nextPath, grandChild, depth + 1);
  }
}

/** `1. e4 e5 2. Nf3`, or `1... e5 2. Nf3` from a Black-to-move root. */
export function formatPath(path: readonly Pick<MoveNode, "ply" | "san">[]): string {
  return path
    .map((node, index) => {
      const number = Math.ceil(node.ply / 2);
      if (node.ply % 2 === 1) return `${number}. ${node.san}`;
      return index === 0 ? `${number}... ${node.san}` : (node.san ?? "");
    })
    .join(" ");
}

function titleFromHeaders(headers: Record<string, string>, index: number): string {
  const known = (value: string | undefined) => {
    const trimmed = value?.trim();
    return trimmed && trimmed !== "?" ? trimmed : null;
  };
  const chapter = known(headers.ChapterName) ?? known(headers.Event);
  if (chapter) return chapter;
  const white = known(headers.White);
  const black = known(headers.Black);
  if (white && black) return `${white} – ${black}`;
  return `Chapter ${index + 1}`;
}

function rootNode(fen: string): MoveNode {
  return {
    id: REPERTOIRE_ROOT_NODE_ID,
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

export type ExportableChapter = {
  title: string;
  headers: Record<string, string>;
  rootFen: string;
  tree: MoveNode[];
};

/** Seven Tag Roster order after Event; Result is written last of them. */
const ROSTER_TAGS = ["Site", "Date", "Round", "White", "Black"];
/** Tags the exporter writes itself. */
const OWNED_TAGS = new Set(["Event", "Result", "SetUp", "FEN"]);

/**
 * One PGN game per chapter: `[Event "<title>"]`, the chapter's other retained tags (Result
 * defaults to `*`), `SetUp`/`FEN` for a custom root, the root comment, then the move tree with
 * comments, NAGs, arrows (`%cal`) and highlights (`%csl`), numbered from the root's real ply.
 */
export function exportRepertoirePgn(chapters: readonly ExportableChapter[]): string {
  return chapters.map(exportChapter).join("\n\n").concat("\n");
}

function exportChapter(chapter: ExportableChapter): string {
  const tag = (name: string, value: string) => `[${name} "${escapeHeader(value)}"]`;
  const lines = [tag("Event", chapter.title)];
  for (const name of ROSTER_TAGS) {
    if (chapter.headers[name] !== undefined) lines.push(tag(name, chapter.headers[name]));
  }
  const result = chapter.headers.Result?.trim() || "*";
  lines.push(tag("Result", result));
  for (const [name, value] of Object.entries(chapter.headers)) {
    if (OWNED_TAGS.has(name) || ROSTER_TAGS.includes(name)) continue;
    lines.push(tag(name, value));
  }
  if (chapter.rootFen !== START_FEN) {
    lines.push(tag("SetUp", "1"), tag("FEN", chapter.rootFen));
  }

  const root = chapter.tree.find((node) => node.id === REPERTOIRE_ROOT_NODE_ID);
  const rootComment = root
    ? serializeAnnotationComment(root.comment, root.arrows, root.highlights)
    : null;
  const movetext = [
    rootComment ? `{ ${rootComment} }` : "",
    serializeMoveTreeMoves(chapter.tree),
    result
  ]
    .filter(Boolean)
    .join(" ");
  return [...lines, "", movetext].join("\n");
}
