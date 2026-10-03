import { create } from "zustand";
import { addMoveNode, createEmptyGame, exportGameToPgn } from "@chaturanga/shared/chess/pgn";
import { applySan, applyUserMove, fenAfterUci, statusForFen } from "@chaturanga/shared/chess/position";
import type { EngineGoClock } from "@chaturanga/shared/types/engine";
import type {
  Color,
  GameHeaders,
  GameMode,
  GameSession,
  GameSource,
  MoveNode,
  UserMove
} from "@chaturanga/shared/types/chess";
import { userMoveFromUci } from "@/lib/uci";

type PendingPromotion = { from: string; to: string } | null;

type EngineClockConfig = {
  initialMs: number;
  incrementMs: number;
};

export type EngineClockLive = {
  whiteMs: number;
  blackMs: number;
  turnStartedAt: number;
  sideToMove: Color;
  /** Set when the game ends (mate, resignation, draw, flag): the clocks freeze at this moment. */
  stoppedAt?: number;
  /** With `stoppedAt`: frozen only for now (the engine's search was set aside), not ended. */
  paused?: boolean;
};

type GameOutcome = {
  result: string;
  termination: string;
};

type GameStore = {
  gameId: string | null;
  source: GameSession["source"];
  headers: GameSession["headers"];
  rootFen: string;
  currentFen: string;
  moveTree: MoveNode[];
  currentNodeId: string;
  orientation: Color;
  mode: GameMode;
  /** The side the app plays for the opponent: the engine in an engine game, the Lichess opponent online. */
  engineSide: Color | null;
  moveTimeMs: number;
  depth: number | null;
  pendingPromotion: PendingPromotion;
  lastError: string | null;
  matchFeedback: string | null;
  engineClock: EngineClockConfig | null;
  engineClockLive: EngineClockLive | null;
  gameOutcome: GameOutcome | null;
  /**
   * Counts moves `makeMove` refused. The board has already drawn the piece on its new square;
   * it puts the position back when this changes (the stored position didn't change).
   */
  rejectedMoves: number;
  /**
   * Counts the boards loaded or started, so a choice made for one board isn't applied to the
   * next (unsaved games all have a null id).
   */
  board: number;
  /** Loads a game; the engine side is cleared (a match sets its own after loading). */
  loadGame: (game: GameSession) => void;
  makeMove: (move: UserMove) => boolean;
  makeUciMove: (uci: string) => boolean;
  goToNode: (nodeId: string) => void;
  /**
   * Play `moves` (SAN or UCI) from `startNodeId`, reusing existing children (main line or an
   * existing variation) and appending the rest as a new variation, then select the final node.
   * Pure navigation: never changes mode or starts an engine. Returns false (and changes nothing)
   * if the start node is unknown or a move is illegal.
   */
  goToLine: (startNodeId: string, moves: readonly string[]) => boolean;
  deleteLineFromNode: (nodeId: string) => boolean;
  undo: () => void;
  redo: () => void;
  reset: () => void;
  flip: () => void;
  setOrientation: (orientation: Color) => void;
  setMode: (mode: GameMode) => void;
  setEngineSide: (side: Color | null) => void;
  setGameSource: (source: GameSource) => void;
  setEngineLimits: (moveTimeMs: number, depth: number | null) => void;
  setGameId: (gameId: string | null) => void;
  setPendingPromotion: (pending: PendingPromotion) => void;
  setNodeAnnotations: (
    nodeId: string,
    annotations: Pick<MoveNode, "arrows" | "highlights">
  ) => void;
  patchHeaders: (patch: Partial<GameHeaders>) => void;
  setEngineMatchClock: (config: EngineClockConfig | null) => void;
  initEngineClockLive: () => void;
  /**
   * Freezes the running clock without ending the game (the user stepped back while the engine was
   * thinking: no search runs, so its time must not run out). `resumeEngineClock` continues it.
   */
  pauseEngineClock: () => void;
  resumeEngineClock: () => void;
  clearEngineMatchExtras: () => void;
  resign: () => void;
  agreeDraw: () => void;
  resolveTimeout: (sideThatLostOnTime: Color) => void;
  /** Ends a match with a result decided elsewhere (the Lichess server). */
  endMatch: (result: string, termination: string) => void;
  /**
   * Makes the main line equal `ucis` (an online game's moves as the server knows them): appends
   * what's new, or rebuilds the line when it differs (a move the server refused). The cursor follows
   * the new moves when it was on the last one. Returns false if a move is illegal.
   */
  syncMainline: (ucis: readonly string[]) => boolean;
  /** Sets both clocks from the server; the side to move's clock runs from now unless `running` is false. */
  setMatchClock: (clock: { whiteMs: number; blackMs: number; sideToMove: Color; running: boolean }) => void;
  /**
   * Back / Forward: shows the loaded game the way it was (node, mode, sides). A match that was
   * still being played comes back as a free board (the engine must not resume by itself, clocks
   * would be stale); a finished engine game keeps its result.
   */
  restoreView: (view: {
    currentNodeId: string;
    mode: GameMode;
    source: GameSource;
    engineSide: Color | null;
    orientation: Color;
    gameOutcome: GameOutcome | null;
  }) => void;
  setMatchFeedback: (message: string | null) => void;
  getClockForEngineGo: () => EngineGoClock | null;
  toSession: () => GameSession;
};

const empty = createEmptyGame();

export const useGameStore = create<GameStore>((set, get) => {
  function finishGame(result: string, termination: string): void {
    set((state) => ({
      gameOutcome: { result, termination },
      headers: { ...state.headers, result, termination },
      engineClockLive: stopClock(state.engineClockLive),
      lastError: null,
      pendingPromotion: null
    }));
  }

  function advanceClockAfterMove(movedSide: Color, now: number): void {
    const state = get();
    if (!state.engineClock || !state.engineClockLive) return;
    const cfg = state.engineClock;
    const live = state.engineClockLive;
    if (live.sideToMove !== movedSide || live.stoppedAt !== undefined) return;
    const elapsed = now - live.turnStartedAt;
    let whiteMs = live.whiteMs;
    let blackMs = live.blackMs;
    if (movedSide === "white") {
      whiteMs = Math.max(0, whiteMs - elapsed + cfg.incrementMs);
    } else {
      blackMs = Math.max(0, blackMs - elapsed + cfg.incrementMs);
    }
    const nextTurn: Color = movedSide === "white" ? "black" : "white";
    set({
      engineClockLive: {
        whiteMs,
        blackMs,
        turnStartedAt: now,
        sideToMove: nextTurn
      }
    });
  }

  return {
    gameId: empty.id,
    source: empty.source,
    headers: empty.headers,
    rootFen: empty.rootFen,
    currentFen: empty.currentFen,
    moveTree: empty.moveTree,
    currentNodeId: empty.currentNodeId,
    orientation: "white",
    mode: "freeplay",
    engineSide: null,
    moveTimeMs: 1000,
    depth: null,
    pendingPromotion: null,
    lastError: null,
    matchFeedback: null,
    engineClock: null,
    engineClockLive: null,
    gameOutcome: null,
    rejectedMoves: 0,
    board: 0,

    loadGame: (game) => {
      const requestedNode = game.moveTree.find((node) => node.id === game.currentNodeId);
      const fallbackNode = game.moveTree.find((node) => node.fenAfter === game.currentFen);
      const rootNode = game.moveTree.find((node) => node.parentId === null) ?? game.moveTree[0];
      const currentNode = requestedNode ?? fallbackNode ?? rootNode;
      set((state) => ({
        board: state.board + 1,
        gameId: game.id,
        source: game.source,
        headers: game.headers,
        rootFen: game.rootFen,
        currentFen: currentNode?.fenAfter ?? game.currentFen,
        moveTree: game.moveTree,
        currentNodeId: currentNode?.id ?? game.currentNodeId,
        orientation: game.headers.orientationHint ?? get().orientation,
        // The session doesn't say who played whom: the last match's side would describe another game.
        engineSide: null,
        pendingPromotion: null,
        lastError: null,
        matchFeedback: null,
        engineClock: null,
        engineClockLive: null,
        gameOutcome: null
      }));
    },

    makeMove: (move) => {
      const state = get();
      const reject = (patch: Partial<GameStore> = {}): false => {
        set((current) => ({ ...patch, rejectedMoves: current.rejectedMoves + 1 }));
        return false;
      };
      if (state.gameOutcome) return reject();
      // Online, a move is only ever played at the end of the game (never as a variation).
      if (state.mode === "online" && state.currentNodeId !== mainlineEndId(state.moveTree)) {
        return reject({ lastError: "Go to the latest move to play." });
      }
      const parent = state.moveTree.find((node) => node.id === state.currentNodeId);
      const fenBefore = parent?.fenAfter ?? state.currentFen;
      const mover = statusForFen(fenBefore).turn;
      // The clock decides, not the poll: a move made after the flag fell loses on time, and the
      // increment can't bring an expired clock back.
      const now = clockNow();
      const live = state.engineClockLive;
      if (
        state.mode === "engine" &&
        live &&
        live.stoppedAt === undefined &&
        live.sideToMove === mover &&
        remainingClockMs(live, mover, now) <= 0
      ) {
        get().resolveTimeout(mover);
        return reject();
      }
      const applied = applyUserMove(fenBefore, move);
      if (!applied) return reject({ lastError: "Illegal move" });
      // A move made while the clock is paused (the user stepped back while the engine thought, and
      // plays on from there): the clock runs again for the side that moved, from the pause, so the
      // time spent there counts against them. If it replaces their own move, that move's increment
      // is taken back first: the replacement earns it again, not a second one. No flag check ran
      // while paused, so one that fell meanwhile falls now: the move is too late, they lose on time.
      const paused = get().engineClockLive;
      if (paused?.paused && paused.stoppedAt !== undefined && !state.gameOutcome) {
        const takeBack = paused.sideToMove !== mover ? (state.engineClock?.incrementMs ?? 0) : 0;
        const running: EngineClockLive = {
          whiteMs: mover === "white" ? Math.max(0, paused.whiteMs - takeBack) : paused.whiteMs,
          blackMs: mover === "black" ? Math.max(0, paused.blackMs - takeBack) : paused.blackMs,
          sideToMove: mover,
          turnStartedAt: paused.stoppedAt
        };
        set({ engineClockLive: running });
        if (remainingClockMs(running, mover, clockNow()) <= 0) {
          get().resolveTimeout(mover);
          // Through reject(): the board takes back the piece it already moved.
          return reject();
        }
      }
      const { moveTree, node } = addMoveNode(
        state.moveTree,
        state.currentNodeId,
        applied.san,
        applied.uci,
        fenBefore,
        applied.fen
      );
      set({ moveTree, currentFen: node.fenAfter, currentNodeId: node.id, lastError: null });
      advanceClockAfterMove(mover, now);
      // Mate / stalemate / draw by rule ends a timed game on the board: freeze both clocks.
      if (get().engineClockLive && statusForFen(node.fenAfter).isEnd) {
        set((current) => ({ engineClockLive: stopClock(current.engineClockLive) }));
      }
      // An engine game ended on the board is decided like a resignation (and as Back brings it
      // back): no more moves, so stepping back can't play on in a variation (Analyze can).
      const ended = boardOutcome(node.fenAfter);
      if (state.mode === "engine" && state.engineSide && ended && mainlineEndId(moveTree) === node.id) {
        // The headers take the result (the moves already say how it ended, no Termination tag).
        set((current) => ({
          gameOutcome: ended,
          headers: { ...current.headers, result: ended.result },
          engineClockLive: stopClock(current.engineClockLive),
          pendingPromotion: null
        }));
      }
      return true;
    },

    makeUciMove: (uci) => {
      const state = get();
      if (state.gameOutcome) return false;
      const parent = state.moveTree.find((node) => node.id === state.currentNodeId);
      const fenBefore = parent?.fenAfter ?? state.currentFen;
      if (!fenAfterUci(fenBefore, uci)) {
        set({ lastError: `Engine returned illegal move: ${uci}` });
        return false;
      }
      const move = userMoveFromUci(uci);
      return move ? get().makeMove(move) : false;
    },

    goToNode: (nodeId) => {
      const node = get().moveTree.find((item) => item.id === nodeId);
      // A promotion being chosen belongs to the position it started from.
      if (node) set({ currentNodeId: node.id, currentFen: node.fenAfter, pendingPromotion: null });
    },

    goToLine: (startNodeId, moves) => {
      const state = get();
      let moveTree = state.moveTree;
      let node = moveTree.find((item) => item.id === startNodeId);
      if (!node) return false;
      // During a live match, only walk existing moves: a new branch would make the engine (or the opponent's) move.
      const liveMatch = isMatchMode(state.mode) && Boolean(state.engineSide) && !state.gameOutcome;
      for (const move of moves) {
        const applied = applyLineMove(node.fenAfter, move);
        if (!applied) return false;
        const parent: MoveNode = node;
        const existing = parent.children
          .map((childId) => moveTree.find((item) => item.id === childId))
          .find((child) => child && (child.fenAfter === applied.fen || child.uci === applied.uci));
        if (existing) {
          node = existing;
          continue;
        }
        if (liveMatch) return false;
        const added = addMoveNode(moveTree, parent.id, applied.san, applied.uci, parent.fenAfter, applied.fen);
        moveTree = added.moveTree;
        node = added.node;
      }
      set({ moveTree, currentNodeId: node.id, currentFen: node.fenAfter, pendingPromotion: null, lastError: null });
      return true;
    },

    deleteLineFromNode: (nodeId) => {
      if (nodeId === "root") return false;
      const state = get();
      const node = state.moveTree.find((item) => item.id === nodeId);
      if (!node?.parentId) return false;

      const idsToDelete = collectSubtreeIds(state.moveTree, nodeId);
      const nextTree = state.moveTree
        .filter((item) => !idsToDelete.has(item.id))
        .map((item) =>
          item.id === node.parentId
            ? { ...item, children: item.children.filter((childId) => childId !== nodeId) }
            : item
        );
      const parent = nextTree.find((item) => item.id === node.parentId);
      if (!parent) return false;
      const currentWasDeleted = idsToDelete.has(state.currentNodeId);
      const survivingCurrent = currentWasDeleted ? parent : nextTree.find((item) => item.id === state.currentNodeId);
      // An outcome the final position decided (mate, stalemate, a draw by rule) goes with it once the
      // main line no longer ends there; a resignation, flag or agreement stays.
      const endFen = nextTree.find((item) => item.id === mainlineEndId(nextTree))?.fenAfter ?? state.rootFen;
      const boardOutcome = state.gameOutcome && BOARD_TERMINATIONS.has(state.gameOutcome.termination);
      set({
        moveTree: nextTree,
        currentNodeId: survivingCurrent?.id ?? parent.id,
        currentFen: survivingCurrent?.fenAfter ?? parent.fenAfter,
        lastError: null,
        ...(boardOutcome && !statusForFen(endFen).isEnd ? { gameOutcome: null } : {})
      });
      return true;
    },

    undo: () => {
      const node = get().moveTree.find((item) => item.id === get().currentNodeId);
      if (node?.parentId) get().goToNode(node.parentId);
    },

    redo: () => {
      const node = get().moveTree.find((item) => item.id === get().currentNodeId);
      if (node?.children[0]) get().goToNode(node.children[0]);
    },

    reset: () => {
      const next = createEmptyGame();
      set((state) => ({
        board: state.board + 1,
        gameId: null,
        source: next.source,
        headers: next.headers,
        rootFen: next.rootFen,
        currentFen: next.currentFen,
        moveTree: next.moveTree,
        currentNodeId: next.currentNodeId,
        mode: "freeplay",
        engineSide: null,
        pendingPromotion: null,
        lastError: null,
        matchFeedback: null,
        engineClock: null,
        engineClockLive: null,
        gameOutcome: null
      }));
    },

    flip: () => set((state) => ({ orientation: state.orientation === "white" ? "black" : "white" })),
    setOrientation: (orientation) => set({ orientation }),
    setMode: (mode) => set({ mode }),
    setEngineSide: (side) => set({ engineSide: side }),
    setGameSource: (source) => set({ source }),
    setEngineLimits: (moveTimeMs, depth) => set({ moveTimeMs, depth }),
    setGameId: (gameId) => set({ gameId }),
    setPendingPromotion: (pending) => set({ pendingPromotion: pending }),
    setNodeAnnotations: (nodeId, annotations) =>
      set((state) => ({
        moveTree: state.moveTree.map((node) =>
          node.id === nodeId ? { ...node, ...annotations } : node
        )
      })),

    patchHeaders: (patch) =>
      set((state) => ({
        headers: { ...state.headers, ...patch }
      })),

    setEngineMatchClock: (config) => set({ engineClock: config, engineClockLive: null }),

    initEngineClockLive: () => {
      const cfg = get().engineClock;
      if (!cfg) return;
      // The side to move where the game starts (after a replayed prefix, not at its root).
      const turn = statusForFen(get().currentFen).turn;
      set({
        engineClockLive: {
          whiteMs: cfg.initialMs,
          blackMs: cfg.initialMs,
          turnStartedAt: clockNow(),
          sideToMove: turn
        }
      });
    },

    pauseEngineClock: () =>
      set((state) => {
        const live = state.engineClockLive;
        if (!live || live.stoppedAt !== undefined) return {};
        return { engineClockLive: { ...live, stoppedAt: clockNow(), paused: true } };
      }),

    resumeEngineClock: () =>
      set((state) => {
        const live = state.engineClockLive;
        if (!live?.paused || live.stoppedAt === undefined || state.gameOutcome) return {};
        const running: EngineClockLive = {
          whiteMs: live.whiteMs,
          blackMs: live.blackMs,
          sideToMove: live.sideToMove,
          turnStartedAt: live.turnStartedAt + (clockNow() - live.stoppedAt)
        };
        return { engineClockLive: running };
      }),

    clearEngineMatchExtras: () =>
      set({
        pendingPromotion: null,
        engineClock: null,
        engineClockLive: null,
        gameOutcome: null,
        matchFeedback: null
      }),

    resign: () => {
      const state = get();
      if (state.mode !== "engine" || !state.engineSide || state.gameOutcome) return;
      const human: Color = state.engineSide === "white" ? "black" : "white";
      const result = human === "white" ? "0-1" : "1-0";
      finishGame(result, "Player resign");
    },

    agreeDraw: () => {
      const state = get();
      if (state.mode !== "engine" || state.gameOutcome) return;
      finishGame("1/2-1/2", "Draw by agreement");
    },

    resolveTimeout: (sideThatLostOnTime) => {
      if (get().gameOutcome) return;
      const winner: Color = sideThatLostOnTime === "white" ? "black" : "white";
      const result = winner === "white" ? "1-0" : "0-1";
      finishGame(result, "Time forfeit");
    },

    endMatch: (result, termination) => {
      if (!get().gameOutcome) finishGame(result, termination);
    },

    syncMainline: (ucis) => {
      const state = get();
      const line = mainlineNodes(state.moveTree);
      const followEnd = state.currentNodeId === (line[line.length - 1]?.id ?? "root");
      let shared = 0;
      while (shared < line.length - 1 && shared < ucis.length && line[shared + 1].uci === ucis[shared]) shared += 1;
      if (shared === line.length - 1 && shared === ucis.length) return true;
      // Keep the moves both agree on; drop the rest of our line (and anything hanging off it).
      let moveTree = state.moveTree;
      const keep = line[shared];
      const stale = keep.children.find((childId) => line.some((node) => node.id === childId));
      if (stale) {
        const removed = collectSubtreeIds(moveTree, stale);
        moveTree = moveTree
          .filter((node) => !removed.has(node.id))
          .map((node) => (node.id === keep.id ? { ...node, children: node.children.filter((id) => id !== stale) } : node));
      }
      let node = moveTree.find((item) => item.id === keep.id) ?? keep;
      for (const uci of ucis.slice(shared)) {
        const applied = applyLineMove(node.fenAfter, uci);
        if (!applied) return false;
        const added = addMoveNode(moveTree, node.id, applied.san, applied.uci, node.fenAfter, applied.fen);
        moveTree = added.moveTree;
        node = added.node;
      }
      const cursorGone = !moveTree.some((item) => item.id === state.currentNodeId);
      const cursor = followEnd || cursorGone ? node : (moveTree.find((item) => item.id === state.currentNodeId) ?? node);
      set({ moveTree, currentNodeId: cursor.id, currentFen: cursor.fenAfter, lastError: null });
      return true;
    },

    setMatchClock: ({ whiteMs, blackMs, sideToMove, running }) => {
      const at = clockNow();
      set({
        engineClockLive: { whiteMs, blackMs, sideToMove, turnStartedAt: at, ...(running ? {} : { stoppedAt: at }) }
      });
    },

    restoreView: (view) =>
      set((state) => {
        const node = state.moveTree.find((item) => item.id === view.currentNodeId);
        // Finished by a result (resignation, flag, agreement) or on the board (mate, stalemate, a draw by rule).
        const endFen = state.moveTree.find((item) => item.id === mainlineEndId(state.moveTree))?.fenAfter ?? state.currentFen;
        const end = boardOutcome(endFen);
        const decidedEngineGame = view.mode === "engine" && Boolean(view.engineSide) && (Boolean(view.gameOutcome) || Boolean(end));
        // Ended on the board: record it as the outcome, so the engine doesn't play on from an earlier move.
        const outcome = view.gameOutcome ?? end;
        const mode: GameMode =
          view.mode === "online" || view.mode === "puzzle" || (view.mode === "engine" && !decidedEngineGame) ? "freeplay" : view.mode;
        return {
          mode,
          source: view.source,
          orientation: view.orientation,
          engineSide: decidedEngineGame ? view.engineSide : null,
          gameOutcome: decidedEngineGame ? outcome : null,
          engineClock: null,
          engineClockLive: null,
          matchFeedback: null,
          pendingPromotion: null,
          lastError: null,
          ...(node ? { currentNodeId: node.id, currentFen: node.fenAfter } : {})
        };
      }),

    setMatchFeedback: (message) => set({ matchFeedback: message }),

    getClockForEngineGo: () => {
      const state = get();
      if (!state.engineClock || !state.engineClockLive) return null;
      return buildEngineGoClock(state.engineClockLive, state.engineClock, clockNow());
    },

    toSession: () => {
      const state = get();
      return {
        id: state.gameId,
        source: state.source,
        headers: state.headers,
        rootFen: state.rootFen,
        currentFen: state.currentFen,
        currentNodeId: state.currentNodeId,
        moveTree: state.moveTree,
        pgn: exportGameToPgn({ headers: state.headers, moveTree: state.moveTree })
      };
    }
  };
});

export function buildEngineGoClock(
  live: EngineClockLive,
  cfg: EngineClockConfig,
  now: number
): EngineGoClock {
  const elapsed = now - live.turnStartedAt;
  let w = live.whiteMs;
  let b = live.blackMs;
  if (live.sideToMove === "white") w -= elapsed;
  else b -= elapsed;
  return {
    wtime: Math.max(1, Math.floor(w)),
    btime: Math.max(1, Math.floor(b)),
    winc: Math.max(0, Math.floor(cfg.incrementMs)),
    binc: Math.max(0, Math.floor(cfg.incrementMs))
  };
}

/** Terminations that come from the final position (restoreView records them for board-ended games). */
const BOARD_TERMINATIONS = new Set(["checkmate", "stalemate", "draw"]);

/** The result of a position that ends the game on the board (mate, stalemate, a draw by rule), or null. */
function boardOutcome(fen: string): GameOutcome | null {
  const end = statusForFen(fen);
  if (!end.isEnd) return null;
  return { result: end.result, termination: end.isCheckmate ? "checkmate" : end.isStalemate ? "stalemate" : "draw" };
}

/** Engine games and online games: the user against an opponent the app moves for. */
export function isMatchMode(mode: GameMode): boolean {
  return mode === "engine" || mode === "online";
}

/** Root, then the main line (first child at every step). */
function mainlineNodes(moveTree: MoveNode[]): MoveNode[] {
  const byId = new Map(moveTree.map((node) => [node.id, node]));
  const root = moveTree.find((node) => node.parentId === null) ?? moveTree[0];
  const line: MoveNode[] = root ? [root] : [];
  let next = root?.children[0];
  while (next) {
    const node = byId.get(next);
    if (!node) break;
    line.push(node);
    next = node.children[0];
  }
  return line;
}

/** The main line's moves in UCI (an online game's moves as this board has them). */
export function mainlineUcis(moveTree: MoveNode[]): string[] {
  return mainlineNodes(moveTree).flatMap((node) => (node.uci ? [node.uci] : []));
}

function mainlineEndId(moveTree: MoveNode[]): string {
  const line = mainlineNodes(moveTree);
  return line[line.length - 1]?.id ?? "root";
}

function stopClock(live: EngineClockLive | null): EngineClockLive | null {
  if (!live) return live;
  // A paused clock ends frozen where it was paused.
  if (live.paused) return { ...live, paused: false };
  return live.stoppedAt === undefined ? { ...live, stoppedAt: clockNow() } : live;
}

/** Where the time asleep comes from (the main process; tests swap it). */
let readTimeAsleep: () => number = () =>
  typeof window === "undefined" ? 0 : (window.chaturanga?.system?.timeAsleepMs?.() ?? 0);

/**
 * A wall-clock step this far past the monotonic one means the computer may have slept. Small, so
 * even a sub-second suspend is read before a move is timed (not left to the wake notice, which can
 * arrive after it), yet above the millisecond jitter between the two clocks, so a normal check
 * never asks the main process.
 */
const SUSPECT_SLEEP_MS = 25;
let lastMonotonic = performance.now();
let lastWall = Date.now();
/**
 * Main's total since the app started, read once now: a renderer reloaded later would otherwise
 * start from 0 and add every earlier sleep at its first check, jumping a running clock forward.
 */
let timeAsleep = readTimeAsleep();
/** The main process said the computer woke up: read the total at the next clock check. */
let resumedSinceRead = false;

/**
 * The time base for match clocks: monotonic, so changing the system clock (or an NTP correction)
 * never adds or removes thinking time. Only differences between two readings mean anything.
 * `performance.now()` may stop while the computer sleeps, so the time it missed is added back —
 * as the main process measured it (from suspend to resume, not from wall-clock jumps). That is
 * read synchronously only when the two clocks drift apart since the last reading, which a sleep
 * always causes: a clock check never waits on the main process otherwise.
 */
export function clockNow(): number {
  const monotonic = performance.now();
  const wall = Date.now();
  if (resumedSinceRead || wall - lastWall - (monotonic - lastMonotonic) > SUSPECT_SLEEP_MS) {
    timeAsleep = readTimeAsleep();
    resumedSinceRead = false;
  }
  lastMonotonic = monotonic;
  lastWall = wall;
  return monotonic + timeAsleep;
}

/** The computer woke up (main's notice): the next clock check reads the time asleep. */
export function noteSystemResumed(): void {
  resumedSinceRead = true;
}

export function setTimeAsleepSource(source: () => number): void {
  readTimeAsleep = source;
}

/** Time left on `side`'s clock at `now` (the running side's clock counts down; a stopped game is frozen). */
export function remainingClockMs(live: EngineClockLive, side: Color, now: number): number {
  const at = live.stoppedAt === undefined ? now : Math.min(now, live.stoppedAt);
  const elapsed = live.sideToMove === side ? Math.max(0, at - live.turnStartedAt) : 0;
  return Math.max(0, (side === "white" ? live.whiteMs : live.blackMs) - elapsed);
}

function applyLineMove(fen: string, move: string): { fen: string; san: string; uci: string } | null {
  try {
    const userMove = userMoveFromUci(move);
    return userMove ? applyUserMove(fen, userMove) : applySan(fen, move);
  } catch {
    return null;
  }
}

function collectSubtreeIds(moveTree: MoveNode[], rootId: string): Set<string> {
  const nodeMap = new Map(moveTree.map((node) => [node.id, node]));
  const ids = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop();
    if (!id || ids.has(id)) continue;
    ids.add(id);
    const node = nodeMap.get(id);
    if (node) stack.push(...node.children);
  }
  return ids;
}
