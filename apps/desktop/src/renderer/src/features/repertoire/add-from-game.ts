import { START_FEN } from "@chaturanga/shared/chess/position";
import type { GameHeaders, MoveNode, SavedGame } from "@chaturanga/shared/types/chess";
import {
  REPERTOIRE_ROOT_NODE_ID,
  type AddFromGameInput,
  type AddFromGamePreview,
  type AddFromGameScope,
  type AddFromGameSource,
  type ChapterKind,
  type RepertoireSummary
} from "@chaturanga/shared/types/repertoire";
import { sessionFromSavedGame } from "../game/saved-game";
import { sanOf } from "./repertoire-model";

/** Pure helpers for "Add to repertoire" (design §6.2): source, defaults, scope, policy, hashing. */

/* ------------------------------------------------------------------ source */

/** PGN tag names for the camelCase header keys whose tag isn't the key capitalised. */
const TAG_NAMES: Partial<Record<keyof GameHeaders, string>> = {
  eco: "ECO",
  utcDate: "UTCDate",
  utcTime: "UTCTime"
};

/** Header keys that are app hints rather than PGN tags. */
const SKIPPED_HEADERS = new Set<string>(["orientationHint"]);

/**
 * A game's headers as a PGN tag map (`White`, `Black`, `Event`, `ECO`…), keeping only non-empty
 * string values: null, missing and non-string entries are left out.
 */
export function sourceHeaders(headers: GameHeaders | null | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (SKIPPED_HEADERS.has(key) || typeof value !== "string" || !value.trim()) continue;
    const tag = TAG_NAMES[key as keyof GameHeaders] ?? key.charAt(0).toUpperCase() + key.slice(1);
    result[tag] = value;
  }
  return result;
}

/** The parts of the game store a source is built from. */
export type BoardGame = {
  gameId: string | null;
  headers: GameHeaders;
  rootFen: string;
  moveTree: MoveNode[];
  currentNodeId: string;
};

/** The board's game as a source; the selected node is kept as provenance (null at the root). */
export function sourceFromBoard(game: BoardGame): AddFromGameSource {
  return {
    gameId: game.gameId,
    headers: sourceHeaders(game.headers),
    rootFen: game.rootFen || START_FEN,
    tree: game.moveTree,
    nodeId: game.currentNodeId === REPERTOIRE_ROOT_NODE_ID ? null : game.currentNodeId
  };
}

/** A library game as a source (no node: the Library has no cursor). */
export function sourceFromSavedGame(saved: SavedGame): AddFromGameSource {
  const session = sessionFromSavedGame(saved);
  return {
    gameId: saved.id,
    headers: sourceHeaders(session.headers),
    rootFen: session.rootFen || START_FEN,
    tree: session.moveTree,
    nodeId: null
  };
}

/** Whether a tree has at least one move (a root alone can't be added). */
export function hasMoves(tree: readonly MoveNode[]): boolean {
  return tree.some((node) => node.parentId !== null);
}

/** A header by tag name, whatever its case (`White` / `white`); empty when missing. */
export function headerValue(headers: Record<string, string>, name: string): string {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted && typeof value === "string") return value.trim();
  }
  return "";
}

function players(headers: Record<string, string>): string {
  const white = headerValue(headers, "White");
  const black = headerValue(headers, "Black");
  if (!white && !black) return "";
  return `${white || "?"} – ${black || "?"}`;
}

/** A new chapter's proposed title: "White – Black", else the event, else "Game". */
export function defaultChapterTitle(headers: Record<string, string>): string {
  return players(headers) || headerValue(headers, "Event") || "Game";
}

/**
 * A linked game in words: "White – Black (Event)", either part alone, else (an analysis board game
 * without tags) "Analysis board · <date>" with the date the link was made.
 */
export function gameLinkLabel(headers: Record<string, string>, createdAt: number): string {
  const names = players(headers);
  const value = headerValue(headers, "Event");
  const event = value === "?" ? "" : value;
  if (names && event) return `${names} (${event})`;
  if (names || event) return names || event;
  const date = new Date(createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
  return `Analysis board · ${date}`;
}

/**
 * The root a new repertoire starts from: the FEN typed for "From FEN"; for "Current game" the
 * board game's root when it isn't the initial position, and only on the plain Create path (an
 * imported PGN brings its own games, so "Create and import PGN" starts from the initial
 * position); null for the initial position.
 */
export function newRepertoireRootFen(
  startFrom: "initial" | "fen" | "game",
  fen: string,
  gameRootFen: string | null,
  next: "study" | "import"
): string | null {
  if (startFrom === "fen") return fen.trim();
  if (startFrom !== "game" || next === "import" || !gameRootFen) return null;
  return gameRootFen === START_FEN ? null : gameRootFen;
}

/* ------------------------------------------------------------------ destination defaults */

/** Where the dialog was opened from. */
export type AddEntryPoint = "library" | "board" | "new-repertoire";

/**
 * The repertoire selected when the dialog opens: the first candidate (a preselection, the last
 * one added to, the one last studied) that is still an active repertoire; none otherwise. The
 * colour of the game is never used to guess.
 */
export function defaultRepertoireId(
  repertoires: readonly Pick<RepertoireSummary, "id" | "archivedAt">[],
  candidates: readonly (string | null | undefined)[]
): string | null {
  const active = new Set(repertoires.filter((item) => !item.archivedAt).map((item) => item.id));
  return candidates.find((id): id is string => Boolean(id && active.has(id))) ?? null;
}

/* ------------------------------------------------------------------ scope */

export type ScopeChoice = AddFromGameScope["kind"];

export type ScopeOption = { value: ScopeChoice; label: string; disabled: boolean };

/**
 * The scope choices for a selected game node: "Line to here" and "This branch" need a selected
 * move (not the root), "Whole game" needs any move.
 */
export function scopeOptions(tree: readonly MoveNode[], nodeId: string | null): ScopeOption[] {
  const node = nodeId ? tree.find((item) => item.id === nodeId) : undefined;
  const onMove = Boolean(node && node.parentId !== null);
  return [
    { value: "path", label: "Line to here", disabled: !onMove },
    { value: "subtree", label: "This branch", disabled: !onMove },
    { value: "whole-game", label: "Whole game", disabled: !hasMoves(tree) }
  ];
}

/** The scope selected at first: the hint when it's available, else the whole game. */
export function initialScopeChoice(
  hint: AddFromGameScope,
  options: readonly ScopeOption[]
): ScopeChoice {
  const available = options.find((option) => option.value === hint.kind && !option.disabled);
  return available ? hint.kind : "whole-game";
}

/** The node a path/subtree scope hint points at (null for the whole game). */
export function scopeNodeId(scope: AddFromGameScope): string | null {
  if (scope.kind === "path") return scope.toNodeId;
  if (scope.kind === "subtree") return scope.fromNodeId;
  return null;
}

/** The scope to send for a choice at `nodeId`; a branch keeps the game's moves or starts there. */
export function buildScope(
  choice: ScopeChoice,
  nodeId: string | null,
  branchRoot: "original" | "standalone"
): AddFromGameScope {
  if (choice === "path" && nodeId) return { kind: "path", toNodeId: nodeId };
  if (choice === "subtree" && nodeId)
    return { kind: "subtree", fromNodeId: nodeId, root: branchRoot };
  return { kind: "whole-game" };
}

/** A new chapter's kind for a scope: a whole game is reference material; an excerpt is opening. */
export function defaultChapterKind(choice: ScopeChoice): ChapterKind {
  return choice === "whole-game" ? "reference" : "opening";
}

/* ------------------------------------------------------------------ policy */

type ConfirmedPolicy = NonNullable<AddFromGameInput["policy"]>;

/**
 * The choice policy being confirmed. `baseKey` names the preview (input without its policy) whose
 * defaults it was initialised from; null until the first preview arrives. `replies` are the
 * material's opponent moves (the preview's `opponentMoves`) plus the default covered ones: the
 * set "Cover opponent replies" covers.
 */
export type PolicyState = {
  baseKey: string | null;
  included: string[];
  replies: string[];
  coverReplies: boolean;
};

export type PolicyAction =
  | {
      type: "init";
      baseKey: string;
      preview: Pick<AddFromGamePreview, "defaultPolicy" | "opponentMoves">;
    }
  | { type: "toggle"; nodeId: string }
  | { type: "set-cover"; on: boolean }
  | { type: "reset" };

export const EMPTY_POLICY_STATE: PolicyState = {
  baseKey: null,
  included: [],
  replies: [],
  coverReplies: true
};

/** Own-move checkboxes and the "Cover opponent replies" switch. */
export function policyReducer(state: PolicyState, action: PolicyAction): PolicyState {
  switch (action.type) {
    case "init": {
      // Defaults apply once per scope/destination; later previews keep the user's choices.
      if (state.baseKey === action.baseKey) return state;
      const { defaultPolicy, opponentMoves } = action.preview;
      return {
        baseKey: action.baseKey,
        included: [...defaultPolicy.includedNodeIds],
        replies: [
          ...new Set([...opponentMoves.map((move) => move.nodeId), ...defaultPolicy.coveredNodeIds])
        ],
        coverReplies: state.coverReplies
      };
    }
    case "toggle":
      return {
        ...state,
        included: state.included.includes(action.nodeId)
          ? state.included.filter((id) => id !== action.nodeId)
          : [...state.included, action.nodeId]
      };
    case "set-cover":
      return { ...state, coverReplies: action.on };
    case "reset":
      return { ...EMPTY_POLICY_STATE, coverReplies: state.coverReplies };
  }
}

/**
 * The policy to send for the preview named `baseKey`: the confirmed own moves and, with the
 * switch on, the opponent replies, once initialised from that preview; null before (the first
 * preview proposes the defaults).
 */
export function policyFor(state: PolicyState, baseKey: string): ConfirmedPolicy | null {
  if (state.baseKey !== baseKey) return null;
  return {
    includedNodeIds: [...state.included].sort(),
    coveredNodeIds: state.coverReplies ? [...state.replies].sort() : []
  };
}

/* ------------------------------------------------------------------ hashing */

/** FNV-1a (32-bit) of a string, base 36. */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** A game tree's content (ids, moves, parents and order), without comments or shapes. */
function treeText(tree: readonly MoveNode[]): string {
  return tree
    .map((node) => `${node.id}:${node.parentId ?? ""}:${node.uci ?? ""}:${node.children.join(",")}`)
    .join(";");
}

/**
 * What the proposed policy depends on: the repertoire, where the material goes (a new chapter's
 * kind, not its title), the scope and the source's moves. The choices a user confirmed are kept
 * until this changes; a new title or revision keeps them. The source's node is provenance only.
 */
export function addInputBaseKey(
  input: Omit<AddFromGameInput, "policy" | "expectedRevision">
): string {
  const { source, destination } = input;
  return fnv1a(
    JSON.stringify([
      input.repertoireId,
      destination.kind === "new-chapter"
        ? `new:${destination.chapterKind}`
        : `existing:${destination.chapterId}`,
      input.scope,
      source.gameId,
      source.rootFen,
      treeText(source.tree)
    ])
  );
}

/**
 * The whole input's hash for the preview key: the base key, the revision, a new chapter's title
 * and the policy (in any order; null asks for the defaults).
 */
export function hashAddInput(input: AddFromGameInput): string {
  const rest = [
    input.expectedRevision,
    input.destination.kind === "new-chapter" ? input.destination.title : "",
    input.policy
      ? [[...input.policy.includedNodeIds].sort(), [...input.policy.coveredNodeIds].sort()]
      : null
  ];
  return `${addInputBaseKey(input)}-${fnv1a(JSON.stringify(rest))}`;
}

/* ------------------------------------------------------------------ preview text */

/**
 * A conflict in words: "At 1. e4 e5 2. Nf3 Nc6: you play Bc4 here; this adds Bb5 as an
 * alternative". The location is the game's path to that position, else the move number.
 */
export function conflictText(conflict: AddFromGamePreview["conflicts"][number]): string {
  const fields = conflict.fen.split(" ");
  const where =
    conflict.path.trim() ||
    `move ${fields[5] ?? "?"}${fields[1] === "b" ? " (Black to move)" : ""}`;
  // The preference while it is still one of the supported moves, else the first supported one.
  const preferred =
    conflict.preferredUci && conflict.existingUcis.includes(conflict.preferredUci)
      ? conflict.preferredUci
      : conflict.existingUcis[0];
  const played = preferred ? sanOf(conflict.fen, preferred) : "another move";
  return `At ${where}: you play ${played} here; this adds ${conflict.newSan} as an alternative`;
}
