import { useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RepertoireDetail } from "@chaturanga/shared/types/repertoire";
import { useAppNoticeStore } from "../../../stores/app-notice-store";
import {
  useInsightsReportQuery,
  useInsightsStatusQuery
} from "../../../queries/repertoire-insights";
import { repertoireKeys } from "../../../queries/repertoire";
import { useOpenSettings } from "../../settings/settings-link";
import { RepertoireHealthCard } from "../explorer/RepertoireHealthCard";
import type { StudyOpenTarget } from "../repertoire-chapters";
import {
  forgotStudyTarget,
  prepareStudyTarget,
  type InsightsActions,
  type InsightsReviewTarget,
  type WeakSpotsTarget
} from "./insights-actions";
import { InsightsFiltersStrip } from "./InsightsFilters";
import { InsightsGamesCard } from "./InsightsGames";
import { InsightsReportCard } from "./InsightsReport";
import { useInsightsViewStore } from "./insights-view-store";

export type InsightsTabProps = {
  /** Study at a position (Open in Study and Prepare carry the From your games banner). */
  onStudy: (target: StudyOpenTarget) => void;
  /** Weak-spots practice (Practice's `weak` mode): every forgotten position, or one. */
  onPractiseWeakSpots: (target: WeakSpotsTarget) => void;
  /** Practice weak spots over every repertoire can start (their list is read). */
  weakSpotsReady: boolean;
  /** Game review of a game at a move; its titlebar offers Back to Insights. */
  onReviewGame: (target: InsightsReviewTarget) => void;
};

/**
 * Repertoire → Insights (docs/repertoire-games-and-practice.md §5; UI §2f): one scrolling page of
 * four cards — the saved filters, the report, the repertoire health check, and the games list. The
 * report's rows and bar segments filter the games list and scroll to it.
 */
export function InsightsTab({
  onStudy,
  onPractiseWeakSpots,
  weakSpotsReady,
  onReviewGame
}: InsightsTabProps) {
  const queryClient = useQueryClient();
  const openSettings = useOpenSettings();
  // Kept outside the tab, so coming back to Insights (Back after Review game) shows it as left.
  const lineMove = useInsightsViewStore((state) => state.lineMove);
  const setLineMove = useInsightsViewStore((state) => state.setLineMove);
  const gamesQuery = useInsightsViewStore((state) => state.gamesQuery);
  const setGamesQuery = useInsightsViewStore((state) => state.setGamesQuery);
  const gamesRef = useRef<HTMLElement | null>(null);
  const report = useInsightsReportQuery(lineMove);
  const status = useInsightsStatusQuery();

  const studyOrSay = (target: StudyOpenTarget | null) => {
    if (target) onStudy(target);
    else useAppNoticeStore.getState().show("No chapter of this repertoire has that position now.");
  };

  /** Study at the repertoire's first chapter, on the Explorer tab (the health check's Open). */
  const openRepertoire = async (repertoireId: string) => {
    const detail = await queryClient
      .fetchQuery({
        queryKey: repertoireKeys.detail(repertoireId),
        queryFn: (): Promise<RepertoireDetail> => {
          const api = window.chaturanga?.repertoires;
          if (!api) throw new Error("Repertoires need the desktop app.");
          return api.get(repertoireId);
        }
      })
      .catch(() => null);
    const chapter = detail?.chapters.at(0);
    studyOrSay(
      chapter ? { repertoireId, chapterId: chapter.id, nodeId: null, tab: "explorer" } : null
    );
  };

  const actions: InsightsActions = {
    practise: (spot) =>
      onPractiseWeakSpots(
        spot ? { repertoireId: spot.repertoireId, positionKey: spot.positionKey } : null
      ),
    studyForgot: (spot) => studyOrSay(forgotStudyTarget(spot)),
    prepare: (reply) => studyOrSay(prepareStudyTarget(reply)),
    study: onStudy,
    reviewGame: onReviewGame,
    showGames: (filter) => {
      setGamesQuery({ page: 0, ...filter });
      gamesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    openSettings: () => openSettings?.("lichess")
  };

  return (
    <div className="flex flex-col gap-4">
      <InsightsFiltersStrip counts={report.data} />
      <InsightsReportCard
        report={report}
        status={status.data}
        lineMove={lineMove}
        onLineMoveChange={setLineMove}
        practiseAllReady={weakSpotsReady}
        actions={actions}
      />
      <RepertoireHealthCard onOpen={(repertoireId) => void openRepertoire(repertoireId)} />
      <InsightsGamesCard
        ref={gamesRef}
        query={gamesQuery}
        onQueryChange={setGamesQuery}
        onReview={onReviewGame}
      />
    </div>
  );
}
