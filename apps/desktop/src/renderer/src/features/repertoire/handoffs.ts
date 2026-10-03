import { addMoveNode, exportGameToPgn, rootPly } from "@chaturanga/shared/chess/pgn";
import { applyUserMove, statusForFen } from "@chaturanga/shared/chess/position";
import { buildChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import type { Color, GameHeaders, GameSession, MoveNode } from "@chaturanga/shared/types/chess";
import {
  REPERTOIRE_ROOT_NODE_ID,
  type LinkGameInput,
  type RepertoireChapter
} from "@chaturanga/shared/types/repertoire";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { positionStatus } from "@/lib/position-status";
import { userMoveFromUci } from "@/lib/uci";
import type { PlayInitialSession } from "../../stores/play-draft-store";
import { isHandoffGame, type PlayedHandoff } from "../../stores/repertoire-handoff-store";
import { pathLabel } from "./repertoire-model";

/*
 * Study → Play from here (design §6.2, §6.4, §9.3): the pure parts. A handoff copies the chapter's
 * route into a new, independent game; nothing here reads or writes a store.
 */

const DECIDED_RESULTS = new Set(["1-0", "0-1", "1/2-1/2"]);

/**
 * Whether a game has ended: a result decided this session (resignation, flag, agreement), a
 * decided result in its headers (such a game reopened from the library, whose final position
 * needn't show it), or a finished position at the end of its main line (`endFen`).
 */
export function gameHasEnded(game: {
  gameOutcome: unknown;
  headers: Pick<GameHeaders, "result">;
  endFen: string;
}): boolean {
  return (
    Boolean(game.gameOutcome) ||
    DECIDED_RESULTS.has(game.headers.result?.trim() ?? "") ||
    positionStatus(game.endFen).isEnd
  );
}

/** The chapter and position a handoff starts from, and the repertoire it belongs to. */
export type HandoffOrigin = {
  repertoireId: string;
  repertoireName: string;
  color: Color;
  chapter: Pick<RepertoireChapter, "id" | "title" | "rootFen" | "tree">;
  nodeId: string;
};

/** The chapter's nodes from the root to `nodeId` (the root alone when the node is unknown). */
export function chapterPath(chapter: Pick<RepertoireChapter, "tree">, nodeId: string): MoveNode[] {
  const lookup = buildChapterLookup(chapter);
  const ids = lookup.parentPath.get(nodeId) ?? lookup.parentPath.get(REPERTOIRE_ROOT_NODE_ID) ?? [];
  return ids.flatMap((id) => {
    const node = lookup.nodesById.get(id);
    return node ? [node] : [];
  });
}

/** "<repertoire> › <chapter>", the start of the Play card's label. */
export function handoffTitle(origin: Pick<HandoffOrigin, "repertoireName" | "chapter">): string {
  return `${origin.repertoireName} › ${origin.chapter.title}`;
}

/** The handoff's SAN route ("1. e4 e5 2. Nf3"), or "Start" at the chapter's root. */
export function handoffPathLabel(origin: Pick<HandoffOrigin, "chapter" | "nodeId">): string {
  return pathLabel(buildChapterLookup(origin.chapter), origin.nodeId);
}

/** Why Play from here is refused (and the study engine has nothing to search) at a mate or a draw. */
export const NO_MOVES_TO_PLAY = "This position has no moves to play";

/** Whether the handoff's position is over (mate, stalemate, a draw): nothing to play. */
export function handoffAtEnd(origin: Pick<HandoffOrigin, "chapter" | "nodeId">): boolean {
  const path = chapterPath(origin.chapter, origin.nodeId);
  return statusForFen(path[path.length - 1]?.fenAfter ?? origin.chapter.rootFen).isEnd;
}

/** Study → Play from here: what the Play page needs to start an engine game at the handoff. */
export function buildInitialSession(origin: HandoffOrigin): PlayInitialSession {
  const path = chapterPath(origin.chapter, origin.nodeId);
  const capturedPath = handoffPathLabel(origin);
  const route = capturedPath === "Start" ? "starting position" : capturedPath;
  return {
    rootFen: path[0]?.fenAfter ?? origin.chapter.rootFen,
    moves: path.flatMap((node) => (node.parentId !== null && node.uci ? [node.uci] : [])),
    playerColor: origin.color,
    label: `${handoffTitle(origin)} — ${route}`,
    repertoire: {
      repertoireId: origin.repertoireId,
      chapterId: origin.chapter.id,
      nodeId: path[path.length - 1]?.id ?? REPERTOIRE_ROOT_NODE_ID,
      capturedPath
    }
  };
}

/**
 * The engine game's starting session: the handoff's moves replayed from its root into a new tree
 * (cursor on the last one), so the game keeps the position's history. Null when a move is illegal
 * (a corrupt handoff), and the caller starts nothing.
 */
export function gameFromInitialSession(
  initial: PlayInitialSession,
  headers: GameHeaders
): GameSession | null {
  let moveTree: MoveNode[] = [emptyRoot(initial.rootFen)];
  let node = moveTree[0];
  for (const uci of initial.moves) {
    const move = userMoveFromUci(uci);
    const applied = move ? applyUserMove(node.fenAfter, move) : null;
    if (!applied) return null;
    const added = addMoveNode(
      moveTree,
      node.id,
      applied.san,
      applied.uci,
      node.fenAfter,
      applied.fen
    );
    moveTree = added.moveTree;
    node = added.node;
  }
  return {
    id: null,
    source: "engine-game",
    headers: { result: "*", ...headers },
    rootFen: initial.rootFen,
    currentFen: node.fenAfter,
    currentNodeId: node.id,
    moveTree,
    pgn: exportGameToPgn({ headers: { result: "*", ...headers }, moveTree })
  };
}

function emptyRoot(fen: string): MoveNode {
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

/* ------------------------------------------------------------------ Lichess guard (§6.4) */

/** The repertoire commands App can run; the guard decides which a live Lichess game blocks. */
export type RepertoireCommand =
  | "open-hub"
  | "open-study"
  | "open-practice"
  | "start-practice"
  | "resume-practice"
  | "refresh-decision"
  | "stage-response"
  | "play-from-here"
  | "return-to-repertoire"
  | "review-opening";

/**
 * Commands that would take the screen (or the board) from a Lichess game being played. The hub is
 * only a list of repertoires, so browsing it stays allowed; everything that opens a repertoire
 * board, trains, compares or starts an engine is blocked.
 */
const BOARD_REPLACING: ReadonlySet<RepertoireCommand> = new Set<RepertoireCommand>([
  "open-study",
  "open-practice",
  "start-practice",
  "resume-practice",
  "refresh-decision",
  "stage-response",
  "play-from-here",
  "return-to-repertoire",
  "review-opening"
]);

/**
 * Whether `command` must wait for the Lichess game. Reads the live state at command time (not a
 * finish event): a newer game that started after the last one ended blocks again.
 */
export function repertoireCommandBlocked(
  liveState: { live: { over: boolean } | null },
  command: RepertoireCommand
): boolean {
  const liveGameInProgress = Boolean(liveState.live && !liveState.live.over);
  return liveGameInProgress && BOARD_REPLACING.has(command);
}

/** What the guard says when it blocks a command (the same words as the board's own guard). */
export const LIVE_GAME_NOTICE = "Finish your Lichess game first.";

/**
 * "Review opening" after waiting for the game's save: go on, or stop because a newer navigation
 * took over ("stale"), a Lichess game started meanwhile ("blocked"), or the board is no longer the
 * handoff's game ("gone").
 */
export function reviewOpeningAfterFlush(input: {
  request: number;
  latestRequest: number;
  liveState: { live: { over: boolean } | null };
  played: PlayedHandoff | null;
  gameId: string | null;
}): "go" | "stale" | "blocked" | "gone" {
  if (input.request !== input.latestRequest) return "stale";
  if (repertoireCommandBlocked(input.liveState, "review-opening")) return "blocked";
  if (!input.played || !isHandoffGame(input.played, input.gameId)) return "gone";
  return "go";
}

/* ------------------------------------------------------------------ played-game link */

/**
 * Wraps `repertoires.linkGame` so each (repertoire, game, kind) is linked at most once per app
 * session for a given `stamp` (the game's result: a finished game links again, so the link copies
 * its final headers). A second call while the first runs joins it (with another stamp, it links
 * again once the first settles, and later callers join that), a call after it succeeded does
 * nothing, and a failed call is tried again by the next one. A chapter deleted meanwhile links the
 * game to the repertoire alone. Any other failure is reported once per link through `onError`, not
 * on every retry. The main process is idempotent too; this only spares repeated writes. Resolves
 * with whether the link is (now) in place.
 */
export function createLinkOnce(
  link: (input: LinkGameInput) => Promise<unknown>,
  onError: (message: string) => void = () => {}
) {
  const linked = new Map<string, string>();
  const running = new Map<string, { stamp: string; attempt: Promise<boolean> }>();
  const reported = new Set<string>();
  const linkOrUnfiled = (input: LinkGameInput) =>
    link(input).catch((error: unknown) => {
      if (input.chapterId === null || !ipcErrorMessage(error).includes("Invalid chapterId")) {
        throw error;
      }
      return link({ ...input, chapterId: null });
    });
  const linkNow = (key: string, input: LinkGameInput, stamp: string): Promise<boolean> =>
    linkOrUnfiled(input).then(
      () => {
        linked.set(key, stamp);
        return true;
      },
      (error: unknown) => {
        if (!reported.has(key)) {
          reported.add(key);
          onError(ipcErrorMessage(error));
        }
        return false;
      }
    );
  return (input: LinkGameInput, stamp = ""): Promise<boolean> => {
    const key = `${input.repertoireId}\u0000${input.gameId}\u0000${input.kind}`;
    const pending = running.get(key);
    if (pending?.stamp === stamp) return pending.attempt;
    if (!pending && linked.get(key) === stamp) return Promise.resolve(true);
    const attempt = pending
      ? pending.attempt.then(() => (linked.get(key) === stamp ? true : linkNow(key, input, stamp)))
      : linkNow(key, input, stamp);
    running.set(key, { stamp, attempt });
    void attempt.finally(() => {
      if (running.get(key)?.attempt === attempt) running.delete(key);
    });
    return attempt;
  };
}
