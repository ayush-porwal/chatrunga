/**
 * Repertoire PGN interoperability (design §10): every game of an import becomes a candidate
 * chapter with all of its tags, annotations and variations; export writes one game per chapter.
 */
import { emptyHeaders, parsePgn, startingPosition } from "chessops/pgn";
import type { ChildNode, PgnNodeData } from "chessops/pgn";
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
  /** Why the whole game can't be imported (unsupported variant, bad FEN); its tree is empty. */
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
  { maxGames = 1000, maxNodes = 100_000, maxDepth = 128 }: RepertoirePgnLimits = {}
): ParsedRepertoirePgn {
  const games = parsePgn(pgn, emptyHeaders).filter(
    (game) => game.headers.size > 0 || game.moves.children.length > 0 || game.comments?.length
  );
  if (!games.length) throw new Error("No PGN game found.");
  if (games.length > maxGames) {
    throw new Error(
      `This PGN has ${games.length} games; one import can hold at most ${maxGames}. ` +
        "Split the file and import it in parts."
    );
  }

  const budget = { nodes: 0, maxNodes, maxDepth };
  return {
    games: games.map((game, index) => {
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
        return rejectedGame(
          `Unsupported variant "${variant}": only standard chess can be imported.`
        );
      }
      const starting = startingPosition(game.headers);
      if (starting.isErr) {
        return rejectedGame(`Invalid starting position (FEN tag): ${starting.error.message}.`);
      }

      const rootFen = makeFen(starting.value.toSetup());
      const root = rootNode(rootFen);
      const rootAnnotation = parseAnnotationComment((game.comments ?? []).join(" "));
      root.comment = rootAnnotation.text;
      root.arrows = rootAnnotation.arrows;
      root.highlights = rootAnnotation.highlights;

      const builder: TreeBuilder = {
        tree: [root],
        byId: new Map([[root.id, root]]),
        nextId: 1,
        warnings: [],
        invalidBranches: [],
        budget
      };
      for (const child of game.moves.children) appendMove(builder, root, [], child, 1);

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
    })
  };
}

type TreeBuilder = {
  tree: MoveNode[];
  byId: Map<string, MoveNode>;
  nextId: number;
  warnings: string[];
  invalidBranches: ImportInvalidBranch[];
  budget: { nodes: number; maxNodes: number; maxDepth: number };
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
      throw new Error(
        `This PGN has more than ${budget.maxNodes} moves; split it and import it in parts.`
      );
    }
    const annotation = parseAnnotationComment(
      [...(child.data.startingComments ?? []), ...(child.data.comments ?? [])].join(" ")
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
export function formatPath(path: readonly MoveNode[]): string {
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
