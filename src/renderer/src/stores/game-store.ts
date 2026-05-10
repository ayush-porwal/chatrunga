import { create } from "zustand";
import { addMoveNode, createEmptyGame, exportGameToPgn } from "../../../shared/chess/pgn";
import { applyUserMove, fenAfterUci } from "../../../shared/chess/position";
import type {
  Color,
  GameMode,
  GameSession,
  MoveNode,
  UserMove
} from "../../../shared/types/chess";

type PendingPromotion = {
  from: string;
  to: string;
} | null;

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
  engineSide: Color | null;
  moveTimeMs: number;
  depth: number | null;
  pendingPromotion: PendingPromotion;
  lastError: string | null;
  loadGame: (game: GameSession) => void;
  makeMove: (move: UserMove) => boolean;
  makeUciMove: (uci: string) => boolean;
  goToNode: (nodeId: string) => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
  flip: () => void;
  setMode: (mode: GameMode) => void;
  setEngineSide: (side: Color | null) => void;
  setEngineLimits: (moveTimeMs: number, depth: number | null) => void;
  setGameId: (gameId: string | null) => void;
  setPendingPromotion: (pending: PendingPromotion) => void;
  setNodeAnnotations: (
    nodeId: string,
    annotations: Pick<MoveNode, "arrows" | "highlights">
  ) => void;
  toSession: () => GameSession;
};

const empty = createEmptyGame();

export const useGameStore = create<GameStore>((set, get) => ({
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

  loadGame: (game) =>
    set({
      gameId: game.id,
      source: game.source,
      headers: game.headers,
      rootFen: game.rootFen,
      currentFen: game.currentFen,
      moveTree: game.moveTree,
      currentNodeId: game.currentNodeId,
      lastError: null
    }),

  makeMove: (move) => {
    const state = get();
    const applied = applyUserMove(state.currentFen, move);
    if (!applied) {
      set({ lastError: "Illegal move" });
      return false;
    }
    const { moveTree, node } = addMoveNode(
      state.moveTree,
      state.currentNodeId,
      applied.san,
      applied.uci,
      state.currentFen,
      applied.fen
    );
    set({ moveTree, currentFen: node.fenAfter, currentNodeId: node.id, lastError: null });
    return true;
  },

  makeUciMove: (uci) => {
    const [from, to, promotionChar] = [uci.slice(0, 2), uci.slice(2, 4), uci.slice(4, 5)];
    const promotion =
      promotionChar === "q"
        ? "queen"
        : promotionChar === "r"
          ? "rook"
          : promotionChar === "b"
            ? "bishop"
            : promotionChar === "n"
              ? "knight"
              : undefined;
    const state = get();
    if (!fenAfterUci(state.currentFen, uci)) {
      set({ lastError: `Engine returned illegal move: ${uci}` });
      return false;
    }
    return get().makeMove({ from: from as never, to: to as never, promotion });
  },

  goToNode: (nodeId) => {
    const node = get().moveTree.find((item) => item.id === nodeId);
    if (node) set({ currentNodeId: node.id, currentFen: node.fenAfter });
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
    set({
      gameId: null,
      source: next.source,
      headers: next.headers,
      rootFen: next.rootFen,
      currentFen: next.currentFen,
      moveTree: next.moveTree,
      currentNodeId: next.currentNodeId,
      mode: "freeplay",
      engineSide: null,
      lastError: null
    });
  },

  flip: () => set((state) => ({ orientation: state.orientation === "white" ? "black" : "white" })),
  setMode: (mode) => set({ mode }),
  setEngineSide: (side) => set({ engineSide: side }),
  setEngineLimits: (moveTimeMs, depth) => set({ moveTimeMs, depth }),
  setGameId: (gameId) => set({ gameId }),
  setPendingPromotion: (pending) => set({ pendingPromotion: pending }),
  setNodeAnnotations: (nodeId, annotations) =>
    set((state) => ({
      moveTree: state.moveTree.map((node) =>
        node.id === nodeId ? { ...node, ...annotations } : node
      )
    })),

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
}));
