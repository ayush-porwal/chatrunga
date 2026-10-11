import { useMemo } from "react";
import { engineDisplayName } from "@chaturanga/shared/engine/managed";
import type { GameHeaders } from "@chaturanga/shared/types/chess";
import { defaultSettings } from "@chaturanga/shared/types/settings";
import type { MoveReview } from "@chaturanga/shared/types/engine";
import { useSettingsQuery } from "../../queries/api";
import { useGameStore } from "../../stores/game-store";
import { activeBestLine, bestLineStep } from "../game/best-line-cursor";
import { boardClocksAt, sideToMove } from "../board/board-clocks";
import { BoardStage } from "../board/BoardWorkspace";
import { BoardMoveMarkBadge } from "../board/BoardMoveMarkBadge";
import { EvalBar } from "../board/EvalBar";
import { reviewMoveShapes } from "../board/board-shapes";
import { boardMoveMark } from "../board/move-mark";
import { PlayerRow } from "../board/PlayerIdentity";
import { ReviewBoard } from "./ReviewBoard";
import { uciSquares } from "./review-utils";

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
  // A BEST line on the board: the panels stay on its error, the board shows the line's position
  // (its move highlighted, none of the error's arrows or mark).
  const bestLine = useGameStore(activeBestLine);
  const boardMove = bestLine ? null : (selectedMove ?? null);
  // The engine's arrows follow the board settings shared with Analyze (its best move, or its line
  // numbered); the played move's arrow always shows.
  const settings = useSettingsQuery();
  const bestMoveArrow =
    settings.data?.analysisBestMoveArrow ?? defaultSettings.analysisBestMoveArrow;
  const planArrows = settings.data?.analysisPlanArrows ?? defaultSettings.analysisPlanArrows;
  const arrows = useMemo(
    () => reviewMoveShapes(boardMove, { bestMoveArrow, planArrows }),
    [boardMove, bestMoveArrow, planArrows]
  );
  const lastMove = uciSquares(
    bestLine
      ? bestLineStep(bestLine).uci
      : (selectedMove?.playedMove ??
          moveTree.find((node) => node.id === selectedNodeId)?.uci ??
          null)
  );
  const moveMark = useMemo(
    () => (bestLine ? null : boardMoveMark("review", { moves, nodeId: selectedNodeId })),
    [bestLine, moves, selectedNodeId]
  );
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
  const playerRow = (player: typeof top) => (
    <PlayerRow
      name={player.name}
      elo={player.elo}
      color={player.color}
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
      {/* Its own stacking context: Chessground's layers and the move mark stack within the board. */}
      <div className="relative isolate h-full w-full">
        {/* Square corners: the stage's frame clips the board to its own radius. */}
        <ReviewBoard
          fen={boardFen}
          orientation={orientation}
          shapes={arrows}
          lastMove={lastMove ? [lastMove.orig, lastMove.dest] : undefined}
          className="h-full w-full rounded-none"
        />
        <BoardMoveMarkBadge mark={moveMark} orientation={orientation} />
      </div>
    </BoardStage>
  );
}
