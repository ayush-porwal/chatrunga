import { useEffect } from "react";
import { statusForFen } from "@chaturanga/shared/chess/position";
import { exportGameToPgn } from "@chaturanga/shared/chess/pgn";
import type { MoveNode, SaveGameInput } from "@chaturanga/shared/types/chess";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { isSaveSuppressed, useSaveGameMutation } from "../queries/api";
import { useGameStore } from "../stores/game-store";
import { usePuzzleStore } from "../stores/puzzle-store";
import { useReviewStore } from "../stores/review-store";
import { useSaveStatusStore } from "../stores/save-status-store";

/** Quiet period after the last change before the game is written to the library. */
export const AUTOSAVE_DELAY_MS = 600;

type GameState = ReturnType<typeof useGameStore.getState>;
type ReviewState = ReturnType<typeof useReviewStore.getState>;

/** What a save writes. Two equal documents (same references) need no second write. */
type SavedDocument = Pick<
  GameState,
  "gameId" | "source" | "moveTree" | "headers" | "currentNodeId" | "gameOutcome"
> & {
  review: ReviewState["review"];
};

function documentOf(game: GameState, review: ReviewState["review"]): SavedDocument {
  return {
    gameId: game.gameId,
    source: game.source,
    moveTree: game.moveTree,
    headers: game.headers,
    currentNodeId: game.currentNodeId,
    gameOutcome: game.gameOutcome,
    review
  };
}

export function sameDocument(a: SavedDocument | null, b: SavedDocument): boolean {
  return (
    a !== null &&
    a.gameId === b.gameId &&
    a.source === b.source &&
    a.moveTree === b.moveTree &&
    a.headers === b.headers &&
    a.currentNodeId === b.currentNodeId &&
    a.gameOutcome === b.gameOutcome &&
    a.review === b.review
  );
}

/** Counts every library write, so the save status can tell an older write's reply from a newer's. */
let writeRevision = 0;

/**
 * A library write that succeeded: the game's id, the board it was (the game store's `board`, so a
 * board replaced before its first save is still recognised) and the result it saved.
 */
export type GameSaved = { gameId: string; board: number; result: string };

const savedListeners = new Set<(saved: GameSaved) => void>();

/**
 * Calls `listener` after every successful library write of a game, including the write of a board
 * being replaced and a retry. Returns the unsubscribe.
 */
export function onGameSaved(listener: (saved: GameSaved) => void): () => void {
  savedListeners.add(listener);
  return () => {
    savedListeners.delete(listener);
  };
}

/** A new game's library id, chosen before its first write (see `save`). */
function newGameId(): string {
  return crypto.randomUUID();
}

/**
 * Saves the loaded game (moves, cursor, result and review) to the library shortly after it
 * changes. New empty boards and puzzle practice are never saved; opening a saved game doesn't
 * rewrite it; and a pending save is written before the board is replaced or the window closes.
 */
/** Shown when an import waits for the board's pending save and it fails. */
export const IMPORT_NEEDS_SAVE =
  "Couldn't save the current game first, so nothing was imported. Try again.";

/**
 * A board loaded as an unsaved copy (Play from here's engine game): its tree and headers as
 * they loaded. Like a game opened from the library, it is the baseline: nothing is written until the
 * user changes it (a move, an annotation, a result). Cleared when another board loads.
 */
type UnsavedBaseline = Pick<GameState, "moveTree" | "headers">;
let unsavedBaseline: UnsavedBaseline | null = null;

/**
 * Holds the board just loaded out of the library until it changes. Call right after loading it
 * (after any header patches); a board that already has a library id is unaffected.
 */
export function holdUntilChanged(): void {
  const game = useGameStore.getState();
  unsavedBaseline = game.gameId ? null : { moveTree: game.moveTree, headers: game.headers };
}

/** Whether the loaded board is a held copy nobody has changed yet (history keeps that). */
export function isHeldUnchanged(): boolean {
  return unchangedSinceBaseline(unsavedBaseline, useGameStore.getState());
}

/** A held board is unchanged while it has no id, no result and the same tree and headers. */
export function unchangedSinceBaseline(
  baseline: UnsavedBaseline | null,
  game: Pick<GameState, "gameId" | "moveTree" | "headers" | "gameOutcome">
): boolean {
  return (
    baseline !== null &&
    !game.gameId &&
    !game.gameOutcome &&
    game.moveTree === baseline.moveTree &&
    game.headers === baseline.headers
  );
}

/** The mounted autosave's flush (null when none is mounted). */
let pendingFlush: (() => Promise<boolean>) | null = null;

/**
 * Writes the loaded game's pending changes now (e.g. before importing a PGN, so the library's
 * check for a copy sees the board as it is). Resolves with whether the game on the board is
 * saved: a failure kept for a game left earlier (it has its own Retry) doesn't count here.
 */
export async function flushGameAutosave(): Promise<boolean> {
  // A navigation while a save is awaited replaces the board: flush again for the new one, so the
  // answer is about the board as it is when the import looks (bounded: a board can't keep changing).
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const gameId = useGameStore.getState().gameId;
    if (pendingFlush) await pendingFlush();
    if (useGameStore.getState().gameId !== gameId) continue;
    return !useSaveStatusStore.getState().failures.some((failure) => failure.gameId === gameId);
  }
  return false;
}

export function useGameAutosave(): void {
  const saveGame = useSaveGameMutation().mutateAsync;

  // Subscribes to the stores directly (no React state), so a move or a review update does not
  // re-render the app shell that mounts this hook.
  useEffect(() => {
    let timeout = 0;
    // The mainline end the loaded game's recorded result belongs to (see savedResult).
    let resultAnchor = mainlineEnd(useGameStore.getState().moveTree)?.id ?? null;
    // What the library already holds for the loaded game (null: unknown, so the next save writes).
    let stored: SavedDocument | null = null;
    // The last write, so a flush can wait for it.
    let lastWrite: Promise<unknown> = Promise.resolve();
    // Boards loaded so far, and the latest review that belongs to the board now loaded (set while
    // it was). A review cleared just before the board is replaced (Play → Start clears it first)
    // is still the leaving game's: if it wasn't written yet, it is written with that game.
    let board = 0;
    let boardReview: { board: number; review: NonNullable<ReviewState["review"]> } | null = null;

    const write = (
      input: SaveGameInput,
      document: SavedDocument | null,
      savedBoard: number
    ): Promise<unknown> => {
      const gameId = input.id ?? null;
      const revision = ++writeRevision;
      lastWrite = saveGame(input).then(
        () => {
          // Clears only this game's failure (a game left with a failed save keeps its Retry), and
          // only if this write is newer than the one that failed.
          useSaveStatusStore.getState().saved(gameId, revision);
          if (!gameId) return;
          const saved = { gameId, board: savedBoard, result: input.headers.result ?? "*" };
          for (const listener of savedListeners) {
            try {
              listener(saved);
            } catch {
              // A listener's failure is its own; the game is saved.
            }
          }
        },
        (error: unknown) => {
          if (isSaveSuppressed(error)) return;
          // Not in the library as it is now: the next change (or Retry) writes it again.
          if (document && stored === document) stored = null;
          // Retry writes what failed (it may be a game already left), then anything newer here.
          useSaveStatusStore.getState().setFailed(
            ipcErrorMessage(error) || "The game couldn't be saved.",
            () => {
              void write(input, null, savedBoard).then(() => {
                if (useGameStore.getState().gameId === input.id) void save();
              });
            },
            gameId,
            revision
          );
        }
      );
      return lastWrite;
    };

    const save = (): Promise<unknown> => {
      const game = useGameStore.getState();
      // Puzzle practice is ephemeral: never persist it as a "saved game" / recent entry.
      if (game.mode === "puzzle" && usePuzzleStore.getState().activePuzzle) return lastWrite;
      if (game.moveTree.length <= 1 && !game.gameId) return lastWrite;
      // An unsaved copy (Play from here's engine game) waits for its first change.
      if (unchangedSinceBaseline(unsavedBaseline, game)) return lastWrite;
      const review = useReviewStore.getState().review;
      boardReview = review ? { board, review } : null;
      if (sameDocument(stored, documentOf(game, review))) return lastWrite;
      // A new game gets its id now, before the write: later saves update the same row, and a reply
      // that arrives after the board was replaced can't hand this id to another game.
      if (!game.gameId) useGameStore.getState().setGameId(newGameId());
      const current = useGameStore.getState();
      const document = documentOf(current, review);
      stored = document;
      return write(saveInput(current, resultAnchor, review), document, current.board);
    };

    /** Writes what's waiting now; resolves with whether everything is saved. */
    const flushPending = async (): Promise<boolean> => {
      if (timeout) {
        window.clearTimeout(timeout);
        timeout = 0;
        await save();
      }
      await lastWrite;
      return useSaveStatusStore.getState().error === null;
    };

    const schedule = () => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => {
        timeout = 0;
        void save();
      }, AUTOSAVE_DELAY_MS);
    };

    /**
     * The board is being replaced (another game, a new board) while a save is still waiting: write
     * the game being left now, as it was, or its last changes would be lost (the pending save would
     * read the new board). With the review that belongs to it, if any; else its stored review is
     * left as it is.
     */
    const flushLeaving = (previous: GameState) => {
      if (!timeout) return;
      window.clearTimeout(timeout);
      timeout = 0;
      // Puzzle practice is never saved (its board has no library id).
      if ((previous.mode === "puzzle" || previous.source === "puzzle") && !previous.gameId) return;
      if (previous.moveTree.length <= 1 && !previous.gameId) return;
      if (unchangedSinceBaseline(unsavedBaseline, previous)) return;
      const review = boardReview?.board === board ? boardReview.review : undefined;
      if (stored && sameDocument(stored, documentOf(previous, review ?? stored.review))) return;
      const gameId = previous.gameId ?? newGameId();
      void write(saveInput({ ...previous, gameId }, resultAnchor, review), null, previous.board);
    };

    const unsubscribers = [
      useGameStore.subscribe((state, previous) => {
        // Loading a game or resetting the board replaces headers and move tree together (moves
        // change only the tree, outcomes/header edits only the headers): new recorded result.
        if (state.headers !== previous.headers && state.moveTree !== previous.moveTree) {
          flushLeaving(previous);
          // A held copy belongs to the board it was loaded on (the caller holds a new one after).
          unsavedBaseline = null;
          board += 1;
          resultAnchor = mainlineEnd(state.moveTree)?.id ?? null;
          stored = null;
          if (state.gameId) {
            // A game opened from the library is saved exactly as it loaded (later changes in the
            // same task, like a restored cursor, are edits to save). Its review is loaded right
            // after the game, so that part of the snapshot is filled in once it's in.
            const loaded = documentOf(state, useReviewStore.getState().review);
            stored = loaded;
            queueMicrotask(() => {
              if (stored === loaded)
                stored = { ...loaded, review: useReviewStore.getState().review };
            });
          }
        }
        // Anything a save writes (headers and source too: an edit to only those is an edit), and
        // the mode (puzzle practice isn't saved). The pending timer is what the flushes write.
        if (
          state.currentNodeId !== previous.currentNodeId ||
          state.moveTree !== previous.moveTree ||
          state.headers !== previous.headers ||
          state.source !== previous.source ||
          state.mode !== previous.mode ||
          state.gameOutcome !== previous.gameOutcome
        ) {
          schedule();
        }
      }),
      usePuzzleStore.subscribe((state, previous) => {
        if (state.activePuzzle !== previous.activePuzzle) schedule();
      }),
      useReviewStore.subscribe((state, previous) => {
        if (state.review === previous.review) return;
        // Another analysis of the same game is now shown (switching, or a run that finished): one
        // still waiting to be written (a run just finished, a comment just arrived) is written now,
        // or the save below would only write the new one and its last changes would be lost.
        const outgoing = previous.review;
        // (A review cleared as the board is replaced is written with the leaving game: flushLeaving.)
        if (
          outgoing &&
          state.review &&
          timeout &&
          state.review.reviewId !== outgoing.reviewId &&
          boardReview?.board === board &&
          boardReview.review === outgoing
        ) {
          const game = useGameStore.getState();
          if (game.gameId) void write(saveInput(game, resultAnchor, outgoing), null, game.board);
        }
        if (state.review) boardReview = { board, review: state.review };
        schedule();
      }),
      // Closing the window (or quitting): write what's pending before the renderer goes away.
      window.chaturanga?.games.onFlushRequest?.(flushPending) ?? (() => {})
    ];
    pendingFlush = flushPending;
    return () => {
      if (pendingFlush === flushPending) pendingFlush = null;
      window.clearTimeout(timeout);
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [saveGame]);
}

/**
 * The library row for `game`. The result belongs to the game, not the cursor (see savedResult),
 * and the PGN is written with that same result, so the two never disagree. `review: undefined`
 * keeps the stored review.
 */
function saveInput(
  game: GameState,
  resultAnchor: string | null,
  review: ReviewState["review"] | undefined
): SaveGameInput {
  const end = mainlineEnd(game.moveTree);
  const result = savedResult(
    game.gameOutcome?.result,
    statusForFen(end?.fenAfter ?? game.currentFen).result,
    game.headers.result,
    end?.id === resultAnchor
  );
  const headers = { ...game.headers, result };
  return {
    id: game.gameId,
    source: game.source,
    headers,
    rootFen: game.rootFen,
    currentFen: game.currentFen,
    currentNodeId: game.currentNodeId,
    pgn: exportGameToPgn({ headers, moveTree: game.moveTree }),
    moveTree: game.moveTree,
    ...(review === undefined ? {} : { review })
  };
}

/** Last node of the main line (first child at every step from the root). */
export function mainlineEnd(moveTree: readonly MoveNode[]): MoveNode | null {
  const byId = new Map(moveTree.map((node) => [node.id, node]));
  let node = moveTree.find((item) => item.parentId === null) ?? null;
  while (node?.children[0] && byId.has(node.children[0])) node = byId.get(node.children[0])!;
  return node;
}

/**
 * The result to save. It belongs to the game, not the cursor: a live outcome wins, then a
 * terminal position at the end of the main line. Otherwise the game's recorded result stands only
 * while the main line still ends where it did when the game was loaded — so stepping back through
 * a decided game keeps "1-0", but deleting or adding final moves makes it a game in progress.
 */
export function savedResult(
  outcome: string | undefined,
  mainlineEndResult: string,
  headerResult: string | null | undefined,
  mainlineUnchanged: boolean
): string {
  if (outcome) return outcome;
  if (mainlineEndResult !== "*") return mainlineEndResult;
  return (mainlineUnchanged && headerResult) || "*";
}
