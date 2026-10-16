import type { BroadcastRoundDetail } from "@chaturanga/shared/types/broadcast";
import {
  broadcastSession,
  followBoard,
  type BroadcastGameRef
} from "../features/broadcasts/broadcast-follow";
import { mergeLiveLine } from "../features/broadcasts/live-line";
import { useAppNoticeStore } from "../stores/app-notice-store";
import { useBroadcastStore, type StreamedGame } from "../stores/broadcast-store";
import { currentGame, type AppNavigation } from "./app-navigation";

/** How long a click waits for the round's stream to send the game's moves. */
const GAME_WAIT_MS = 15_000;

/** How long a round's stream opened for a click stays watched: the follow's own watch takes over. */
const HANDOVER_MS = 5000;

/**
 * The game as its round's stream last sent it, waiting a while for its first sending. A round no
 * view streams (a crosstable game of an earlier round) is watched meanwhile.
 */
function streamedGame(gameId: string, roundId: string): Promise<StreamedGame | null> {
  const ready = useBroadcastStore.getState().games[gameId];
  if (ready) return Promise.resolve(ready);
  const api = window.chaturanga?.broadcasts;
  api?.watchRound(roundId).catch(() => undefined);
  return new Promise((resolve) => {
    const done = (game: StreamedGame | null) => {
      unsubscribe();
      clearTimeout(timer);
      setTimeout(() => {
        api?.unwatchRound(roundId).catch(() => undefined);
      }, HANDOVER_MS);
      resolve(game);
    };
    const unsubscribe = useBroadcastStore.subscribe((state) => {
      const game = state.games[gameId];
      if (game) done(game);
    });
    const timer = setTimeout(() => done(null), GAME_WAIT_MS);
  });
}

/**
 * The broadcast commands that put a game on the board. Not a React hook (see useBoardCommands):
 * rebuilt every render, each reads the shell's state as of then.
 */
export function useBroadcastCommands(nav: AppNavigation) {
  const { latestNavigation, commitCurrent, endBoardActivity, setFocusMode, showGame } = nav;

  /**
   * A board of a round opens on the Analyze board at its live position and keeps following the
   * game (broadcast-follow.ts). Its moves come from the round's stream, already open on the
   * tournament page; a click before they arrive waits for them.
   */
  async function openBroadcastGame(detail: BroadcastRoundDetail, gameId: string) {
    const request = ++latestNavigation.current;
    const game = await streamedGame(gameId, detail.round.id);
    // Another navigation (a click elsewhere, Back) meanwhile: it wins.
    if (request !== latestNavigation.current) return;
    if (!game) {
      useAppNoticeStore
        .getState()
        .show("That game's moves haven't arrived from Lichess yet. Try again in a moment.");
      return;
    }
    const ref: BroadcastGameRef = {
      tourId: detail.tour.id,
      tourName: detail.tour.name,
      roundId: detail.round.id,
      roundName: detail.round.name,
      gameId
    };
    const session = broadcastSession(game, ref);
    const merged = session ? mergeLiveLine(session.moveTree, game.moves) : null;
    if (!session || !merged) {
      useAppNoticeStore.getState().show("That game couldn't be opened: its moves don't play out.");
      return;
    }
    commitCurrent();
    endBoardActivity();
    currentGame().loadGame(session);
    currentGame().setMode("freeplay");
    currentGame().startAnalysisBoard();
    followBoard(ref, merged.liveIds);
    setFocusMode(false);
    showGame("notation");
  }

  return { openBroadcastGame };
}

export type BroadcastCommands = ReturnType<typeof useBroadcastCommands>;
