import { useCallback, useMemo, useState } from "react";
import { engineDisplayName } from "@chaturanga/shared/engine/managed";
import type { DrawShape } from "@lichess-org/chessground/draw";
import type {
  BoardArrow,
  BoardHighlight,
  GameHeaders,
  MoveNode
} from "@chaturanga/shared/types/chess";
import { defaultSettings } from "@chaturanga/shared/types/settings";
import type { MoveReview } from "@chaturanga/shared/types/engine";
import { useShallow } from "zustand/react/shallow";
import { useSettingsQuery } from "../../queries/api";
import { useAnalysisStore } from "../../stores/analysis-store";
import { useGameStore } from "../../stores/game-store";
import { boardShowsLiveAnalysis, liveTopLine } from "../analysis/live-analysis";
import { activeBestLine, bestLineStep } from "../game/best-line-cursor";
import { activeScratchLine } from "../game/scratch-line";
import { boardClocksAt, sideToMove } from "../board/board-clocks";
import { BoardStage } from "../board/BoardWorkspace";
import { BoardMoveMarkBadge } from "../board/BoardMoveMarkBadge";
import { ControlledBoard } from "../board/ControlledBoard";
import { EvalBar } from "../board/EvalBar";
import { liveAnalysisShapes, reviewMoveShapes } from "../board/board-shapes";
import { boardMoveMark } from "../board/move-mark";
import { PlayerRow } from "../board/PlayerIdentity";
import { useSavedEngineSide } from "../game/use-saved-engine-side";
import { useYourSide } from "../profile/YourAvatar";
import {
  previewShapes,
  shownPreview,
  useBoardPreviewStore,
  type BoardPreview
} from "./board-preview";
import { uciSquares } from "./review-utils";
import { playScratchMove } from "./scratch-moves";

/** The game's two players as the review names them (an engine by its display name). */
export function reviewPlayers(headers: GameHeaders) {
  return {
    white: {
      name: engineDisplayName(headers.white ?? "") || "White",
      elo: headers.whiteElo ?? null,
      color: "white" as const
    },
    black: {
      name: engineDisplayName(headers.black ?? "") || "Black",
      elo: headers.blackElo ?? null,
      color: "black" as const
    }
  };
}

/**
 * Game review's board: the players with their clocks at the selected move, and the selected
 * move's arrows and mark. `selectedMove` is the review of the selected move (none: unreviewed).
 * The same board as Analyze's and Study's (ControlledBoard): moves played on it go into a scratch
 * line (never the game), arrows and circles drawn on it last only while its position shows, and a
 * move or square the coach's text names shows on it while hovered or focused.
 */
export function ReviewBoardStage({
  moves,
  selectedMove
}: {
  moves: readonly MoveReview[];
  selectedMove: MoveReview | undefined;
}) {
  const moveTree = useGameStore((state) => state.moveTree);
  const selectedNodeId = useGameStore((state) => state.currentNodeId);
  const boardFen = useGameStore((state) => state.currentFen);
  const orientation = useGameStore((state) => state.orientation);
  const headers = useGameStore((state) => state.headers);
  const source = useGameStore((state) => state.source);
  const players = reviewPlayers(headers);
  // The side at the bottom of the board is the orientation; its opponent sits on top.
  const [top, bottom] =
    orientation === "white" ? [players.black, players.white] : [players.white, players.black];
  // Each side's time left at the selected move, from the game's [%clk] (none without them).
  const clocks = useMemo(
    () => boardClocksAt(moveTree, selectedNodeId, headers.timeControl),
    [headers.timeControl, moveTree, selectedNodeId]
  );
  const toMove = sideToMove(boardFen);
  // An engine game's engine side shows the engine's picture.
  const engineSide = useSavedEngineSide(headers);
  const yourSide = useYourSide(headers.white, headers.black, source);
  const playerRow = (player: typeof top) => (
    <PlayerRow
      name={player.name}
      elo={player.elo}
      color={player.color}
      engine={engineSide?.side === player.color ? engineSide.engine : null}
      you={yourSide === player.color}
      clock={clocks?.[player.color] ?? null}
      clockActive={toMove === player.color}
    />
  );
  return (
    <BoardStage
      evalBar={<EvalBar orientation={orientation} />}
      top={playerRow(top)}
      bottom={playerRow(bottom)}
    >
      <ReviewBoardSurface moves={moves} selectedMove={selectedMove} />
    </BoardStage>
  );
}

/**
 * The board itself (the same as Analyze's and Study's, ControlledBoard): the game's move with its
 * arrows and mark, a BEST or scratch line's move, or a coach's move or square previewed. Moves
 * played on it go into the scratch line, never the game; arrows and circles drawn on it last only
 * while its position shows.
 */
function ReviewBoardSurface({
  moves,
  selectedMove
}: {
  moves: readonly MoveReview[];
  selectedMove: MoveReview | undefined;
}) {
  const moveTree = useGameStore((state) => state.moveTree);
  const selectedNodeId = useGameStore((state) => state.currentNodeId);
  const boardFen = useGameStore((state) => state.currentFen);
  const orientation = useGameStore((state) => state.orientation);
  // A BEST or scratch line on the board: the panels stay on the game's move, the board shows the
  // line's position (its move highlighted, none of the game move's arrows or mark).
  const bestLine = useGameStore(activeBestLine);
  const scratch = useGameStore(activeScratchLine);
  const offGame = bestLine ?? scratch;
  // A move or square the coach's text names, while the pointer rests on it (or it has focus): the
  // board only shows it (no moves, no drawings, no sound).
  const preview = useBoardPreviewStore((state) => shownPreview(state.active, boardFen));
  const autoShapes = useReviewAutoShapes({
    preview,
    scratch: Boolean(scratch),
    boardMove: offGame ? null : (selectedMove ?? null)
  });
  const lastMove = uciSquares(
    offGame ? bestLineStep(offGame).uci : gameMoveUci(moveTree, selectedNodeId, selectedMove)
  );
  const moveMark = useMemo(
    () => (offGame ? null : boardMoveMark("review", { moves, nodeId: selectedNodeId })),
    [moves, offGame, selectedNodeId]
  );
  const drawings = usePositionDrawings(`${selectedNodeId} ${boardFen}`);
  const board = preview
    ? { fen: preview.fen, movable: "none" as const, lastMove: null, stepSound: false }
    : {
        fen: boardFen,
        movable: "both" as const,
        lastMove: lastMove ? ([lastMove.orig, lastMove.dest] as const) : null,
        // The game's own steps sound through the game store (useMoveSounds); the line's here.
        stepSound: Boolean(scratch),
        arrows: drawings.arrows,
        highlights: drawings.highlights,
        onShapesChange: drawings.change
      };
  return (
    // Its own stacking context: Chessground's layers and the move mark stack within the board. The
    // data attributes say what it shows besides the game's move (for tests and tools).
    <div
      className="relative isolate h-full w-full"
      data-scratch-line={scratch ? "" : undefined}
      data-drawings={drawings.arrows.length + drawings.highlights.length}
      {...previewAttributes(preview)}
    >
      <ControlledBoard
        {...board}
        orientation={orientation}
        autoShapes={autoShapes}
        onMove={playScratchMove}
      />
      <BoardMoveMarkBadge mark={preview ? null : moveMark} orientation={orientation} />
    </div>
  );
}

/** The previewed move (`data-preview-move`, its UCI) or square (`data-preview-square`). */
function previewAttributes(preview: BoardPreview | null) {
  if (preview?.kind === "move") return { "data-preview-move": preview.uci };
  if (preview?.kind === "square") return { "data-preview-square": preview.square };
  return {};
}

/** The game move on the board's UCI: the reviewed move's, else the tree's (none at the start). */
function gameMoveUci(
  moveTree: readonly MoveNode[],
  nodeId: string,
  review: MoveReview | undefined
): string | null {
  return review?.playedMove ?? moveTree.find((node) => node.id === nodeId)?.uci ?? null;
}

/**
 * The shapes the board draws itself: a preview's move or square, else on a scratch line the live
 * analysis's arrows (its position's search, see useReviewScratchAnalysis), else the reviewed
 * move's arrows (`boardMove`), under the engine arrow settings shared with Analyze (its best move,
 * or its line numbered; the played move's arrow always shows).
 */
function useReviewAutoShapes({
  preview,
  scratch,
  boardMove
}: {
  preview: BoardPreview | null;
  scratch: boolean;
  boardMove: MoveReview | null;
}): DrawShape[] {
  const board = useGameStore(
    useShallow((state) => ({
      mode: state.mode,
      currentNodeId: state.currentNodeId,
      currentFen: state.currentFen
    }))
  );
  const settings = useSettingsQuery();
  const bestMoveArrow =
    settings.data?.analysisBestMoveArrow ?? defaultSettings.analysisBestMoveArrow;
  const planArrows = settings.data?.analysisPlanArrows ?? defaultSettings.analysisPlanArrows;
  const liveLine = useAnalysisStore((state) =>
    scratch && boardShowsLiveAnalysis(board, null, state) ? liveTopLine(state, planArrows) : ""
  );
  return useMemo(() => {
    if (preview) return previewShapes(preview);
    const options = { bestMoveArrow, planArrows };
    if (scratch)
      return liveAnalysisShapes(board.currentFen, liveLine ? liveLine.split(" ") : [], options);
    return reviewMoveShapes(boardMove, options);
  }, [board.currentFen, boardMove, bestMoveArrow, liveLine, planArrows, preview, scratch]);
}

const NO_ARROWS: BoardArrow[] = [];
const NO_HIGHLIGHTS: BoardHighlight[] = [];

/**
 * Arrows and circles drawn on the board (right-click drag), for the position shown only: another
 * position (`key`) starts with none, and nothing is kept or saved.
 */
function usePositionDrawings(key: string) {
  const [drawn, setDrawn] = useState({ key, arrows: NO_ARROWS, highlights: NO_HIGHLIGHTS });
  if (drawn.key !== key) setDrawn({ key, arrows: NO_ARROWS, highlights: NO_HIGHLIGHTS });
  const change = useCallback(
    (arrows: BoardArrow[], highlights: BoardHighlight[]) => setDrawn({ key, arrows, highlights }),
    [key]
  );
  const shown = drawn.key === key ? drawn : { arrows: NO_ARROWS, highlights: NO_HIGHLIGHTS };
  return { arrows: shown.arrows, highlights: shown.highlights, change };
}
