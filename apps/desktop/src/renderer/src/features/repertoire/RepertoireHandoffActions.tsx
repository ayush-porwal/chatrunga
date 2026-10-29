import { lazy, Suspense } from "react";
import { BookOpen, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { mainlineEnd } from "../game/move-tree-model";
import { useGameStore } from "../../stores/game-store";
import { isHandoffGame, useRepertoireHandoffStore } from "../../stores/repertoire-handoff-store";
import { gameHasEnded } from "./handoffs";
import { useInsightsReturnStore } from "./insights/insights-return";

// Shown only after Insights' Review game: its button loads then, out of the first screen's code.
const BackToInsightsButton = lazy(() =>
  import("./insights/BackToInsightsButton").then((module) => ({
    default: module.BackToInsightsButton
  }))
);

/**
 * The titlebar's actions once a game played from a repertoire (Play from here) has ended:
 * "Review opening" (Game review's Opening tab, with the repertoire and colour chosen) and
 * "Return to repertoire" (the chapter and position it started from).
 */
export function RepertoireHandoffActions({
  onReviewOpening,
  onReturnToRepertoire
}: {
  onReviewOpening: () => void;
  onReturnToRepertoire: () => void;
}) {
  const played = useRepertoireHandoffStore((state) => state.played);
  const gameId = useGameStore((state) => state.gameId);
  // Decided by a result (resignation, flag, agreement; saved with a reopened game) or on the board.
  const ended = useGameStore((state) =>
    gameHasEnded({
      gameOutcome: state.gameOutcome,
      headers: state.headers,
      endFen: mainlineEnd(state.moveTree)?.fenAfter ?? state.currentFen
    })
  );
  const engineGame = useGameStore((state) => state.source === "engine-game");
  if (!ended || !engineGame || !isHandoffGame(played, gameId)) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 [-webkit-app-region:no-drag]">
      <Button type="button" variant="ghost" size="sm" onClick={onReturnToRepertoire}>
        <Undo2 />
        Return to repertoire
      </Button>
      <Button type="button" variant="primary" size="sm" onClick={onReviewOpening}>
        <BookOpen />
        Review opening
      </Button>
    </div>
  );
}

/**
 * Game review's "Back to Insights", while the game Insights opened (Review game) is the one shown:
 * the Repertoire page's Insights tab.
 */
export function BackToInsightsAction({ onBack }: { onBack: () => void }) {
  const fromInsights = useInsightsReturnStore((state) => state.gameId);
  const gameId = useGameStore((state) => state.gameId);
  if (!fromInsights || fromInsights !== gameId) return null;
  return (
    <Suspense fallback={null}>
      <BackToInsightsButton onBack={onBack} />
    </Suspense>
  );
}
