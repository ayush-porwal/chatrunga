import { useEffect } from "react";
import { createGameFromFen } from "@chaturanga/shared/chess/pgn";
import type { ChaturangaApi } from "@chaturanga/shared/ipc/chaturanga-api";
import type { LichessEvent, LichessGameFull, LichessGameState, LichessStatus } from "@chaturanga/shared/types/lichess";
import { useEventCallback } from "@/lib/use-event-callback";
import { isGameOver, lichessErrorMessage, lichessHeaders, lichessOutcome, sideToMoveAfter, yourColor } from "../features/lichess/lichess-game";
import { useRefreshGames } from "../queries/api";
import { mainlineUcis, useGameStore } from "../stores/game-store";
import { useLichessStore } from "../stores/lichess-store";

/**
 * Keeps the renderer in step with Lichess: account status, seeks, challenges and import progress go
 * to the Lichess store; the game on the board follows the game stream (moves, clocks, draw offers,
 * the result) and your moves are sent back. `onGameStart` switches the app to the board when a game
 * of yours begins (seek paired, challenge accepted, AI game, resume).
 */
export function useLichess({ onGameStart }: { onGameStart: (load: () => void) => void }): void {
  const openGame = useEventCallback(onGameStart);
  const refreshGames = useEventCallback(useRefreshGames());

  useEffect(() => {
    const bridge = window.chaturanga;
    if (!bridge) return;
    return startLichessSync({ api: bridge.lichess, events: bridge.events, openGame, refreshGames });
  }, [openGame, refreshGames]);
}

const PLAYABLE_VARIANTS = new Set(["standard", "fromPosition"]);

/** useLichess without React (testable): wires the bridge to the stores; returns the teardown. */
export function startLichessSync({
  api,
  events,
  openGame,
  refreshGames
}: {
  api: ChaturangaApi["lichess"];
  events: Pick<ChaturangaApi["events"], "onLichessEvent">;
  /** Opens the board for a starting game: the app runs `load` between leaving its screen and showing the board. */
  openGame: (load: () => void) => void;
  refreshGames: () => void;
}): () => void {
  const lichess = useLichessStore.getState;
  const game = useGameStore.getState;
  let disposed = false;
  // The game we asked to watch, until its first gameFull arrives.
  let pendingGameId: string | null = null;
  // Moves the server has confirmed, and the move of ours on its way to it.
  let serverMoves: string[] = [];
  let sending: string | null = null;

  function refreshAccountLists(): void {
    void Promise.all([api.challenges(), api.ongoingGames()]).then(
      ([challenges, ongoing]) => {
        if (disposed) return;
        lichess().setChallenges(challenges);
        lichess().setOngoingGameIds(ongoing.filter((id) => id !== lichess().live?.id));
      },
      () => undefined
    );
  }

  /**
   * Signed out, the token refused, or another account connected: the main process closed the game's
   * stream, so the board stops following it.
   */
  function applyStatus(status: LichessStatus): void {
    const previousAccountId = lichess().status.account?.id ?? null;
    lichess().setStatus(status);
    const live = lichess().live;
    const accountGone = !status.account || status.tokenRejected || (previousAccountId !== null && status.account.id !== previousAccountId);
    if (accountGone && pendingGameId) {
      // A game still loading belongs to the account that's gone.
      void api.unwatchGame(pendingGameId);
      pendingGameId = null;
    }
    if (accountGone && live && !live.over) {
      lichess().patchLive({ over: true, connected: false });
      game().setMatchFeedback("Signed out of Lichess. The game goes on at lichess.org.");
    }
  }

  void api.status().then(
    (status) => {
      if (disposed) return;
      applyStatus(status);
      if (status.account && !status.tokenRejected) {
        refreshAccountLists();
        // New games played elsewhere come in at every launch.
        void api.syncGames().catch(() => undefined);
      }
    },
    () => lichess().setStatus({ account: null, connecting: false, tokenRejected: false })
  );

  function startGame(gameId: string): void {
    const live = lichess().live;
    if (live?.id === gameId || pendingGameId === gameId) return;
    // One game on the board at a time: another game in progress (or one still loading) waits to be resumed.
    if ((live && !live.over) || pendingGameId) {
      lichess().setOngoingGameIds([...new Set([...lichess().ongoingGameIds, gameId])]);
      return;
    }
    if (live) void api.unwatchGame(live.id);
    pendingGameId = gameId;
    lichess().setSeek(null);
    lichess().setOngoingGameIds(lichess().ongoingGameIds.filter((id) => id !== gameId));
    void api.watchGame(gameId).catch((error: unknown) => {
      if (pendingGameId === gameId) pendingGameId = null;
      game().setMatchFeedback(lichessErrorMessage(error, "Couldn’t open the Lichess game."));
    });
  }

  function loadGame(full: LichessGameFull): void {
    // The board plays standard chess (and games from a position); variants stay on lichess.org.
    if (!PLAYABLE_VARIANTS.has(full.variant)) {
      pendingGameId = null;
      void api.unwatchGame(full.id);
      lichess().setSeek(null, "That game is a chess variant: play it on lichess.org.");
      return;
    }
    const account = lichess().status.account;
    const color = (account && yourColor(full, account.id)) ?? "white";
    pendingGameId = null;
    serverMoves = [];
    sending = null;
    openGame(() => {
      const board = game();
      board.loadGame(createGameFromFen({ fen: full.initialFen, source: "lichess", headers: lichessHeaders(full) }));
      board.setOrientation(color);
      board.setGameSource("lichess");
      board.setMode("online");
      board.setEngineSide(color === "white" ? "black" : "white");
      board.setEngineMatchClock(full.clock);
      board.setMatchFeedback(null);
      lichess().setLive({ id: full.id, yourColor: color, full, drawOffer: null, connected: true, over: false });
      applyState(full, full.state);
    });
  }

  function applyState(full: LichessGameFull, state: LichessGameState): void {
    const board = game();
    serverMoves = state.moves;
    if (sending && state.moves.includes(sending)) sending = null;
    // Our move still on its way stays on the board; anything else follows the server.
    const pending = sending && mainlineUcis(board.moveTree).join(" ") === [...state.moves, sending].join(" ");
    if (!pending && !board.syncMainline(state.moves)) {
      board.setMatchFeedback("The game and the board disagree. Reopen it from Play.");
    }
    const over = isGameOver(state);
    if (full.clock) {
      board.setMatchClock({
        whiteMs: state.wtime,
        blackMs: state.btime,
        sideToMove: sideToMoveAfter(full.initialFen, state.moves.length + (pending ? 1 : 0)),
        // Lichess starts the clocks once both sides have moved.
        running: !over && state.moves.length >= 2
      });
    }
    lichess().patchLive({ drawOffer: state.drawOffer, over, connected: true });
    const outcome = lichessOutcome(state);
    if (outcome) {
      board.endMatch(outcome.result, outcome.termination);
      board.patchHeaders({ result: outcome.result, termination: outcome.termination });
      void api.unwatchGame(full.id);
      refreshAccountLists();
    }
  }

  function handle(event: LichessEvent): void {
    switch (event.type) {
      case "status":
        applyStatus(event.status);
        if (event.status.account && !event.status.tokenRejected) refreshAccountLists();
        return;
      case "seek":
        if (!event.searching) lichess().setSeek(null, event.error);
        return;
      case "challenge":
        lichess().upsertChallenge(event.challenge);
        return;
      case "challengeGone":
        lichess().removeChallenge(event.challengeId);
        return;
      case "gameStart":
        startGame(event.gameId);
        return;
      case "gameFull": {
        const live = lichess().live;
        if (live?.id === event.game.id) {
          // A reconnect: same game, fresh state.
          lichess().patchLive({ full: event.game });
          applyState(event.game, event.game.state);
        } else if (pendingGameId === event.game.id) loadGame(event.game);
        return;
      }
      case "gameState": {
        const live = lichess().live;
        if (live?.id === event.gameId && !live.over) applyState(live.full, event.state);
        return;
      }
      case "gameConnection":
        if (lichess().live?.id === event.gameId) lichess().patchLive({ connected: event.connected });
        return;
      case "sync":
        lichess().setSync({ running: event.running, imported: event.imported, error: event.error });
        if (!event.running && event.imported > 0) refreshGames();
    }
  }

  const unsubscribeEvents = events.onLichessEvent(handle);
  useLichessStore.setState({ resumeGame: startGame });

  // Your moves: a new last move of yours that the server doesn't have yet goes to Lichess.
  const unsubscribeBoard = useGameStore.subscribe((state, previous) => {
    const live = lichess().live;
    if (!live || live.over || state.mode !== "online" || state.moveTree === previous.moveTree) return;
    const line = mainlineUcis(state.moveTree);
    if (line.length !== serverMoves.length + 1 || line.slice(0, -1).join(" ") !== serverMoves.join(" ")) return;
    const uci = line[line.length - 1];
    if (sending === uci || sideToMoveAfter(live.full.initialFen, serverMoves.length) !== live.yourColor) return;
    sending = uci;
    api.move(live.id, uci).catch((error: unknown) => {
      if (sending !== uci) return;
      sending = null;
      game().syncMainline(serverMoves);
      game().setMatchFeedback(lichessErrorMessage(error, "Lichess didn’t accept that move."));
    });
  });

  return () => {
    disposed = true;
    if (lichess().resumeGame === startGame) useLichessStore.setState({ resumeGame: () => undefined });
    unsubscribeEvents();
    unsubscribeBoard();
  };
}

