import { useMemo, useState } from "react";
import { useMatch } from "react-router-dom";
import type { Color } from "@chaturanga/shared/types/chess";
import type { StudyStage } from "../features/repertoire/repertoire-chapters";
import type { StudyFromGames } from "../features/repertoire/study-from-games";
import type { StudyTab } from "../features/repertoire/RepertoireStudyPage";
import type { AppView, RepertoireScreen } from "./AppPages";

/** What App keeps for the repertoire screens besides the ids in the URL. */
export type RepertoireExtras = {
  nodeId: string | null;
  orientation: Color | null;
  tab: StudyTab;
  preset: Extract<RepertoireScreen, { view: "repertoire-practice" }>["preset"];
  /** A move to stage once the study chapter loads (from a game's opening comparison). */
  stage: StudyStage | null;
  /** What the user's games did at the study position (Insights' From your games banner). */
  fromGames: StudyFromGames | null;
};

const initialRepertoireExtras: RepertoireExtras = {
  nodeId: null,
  orientation: null,
  tab: "moves",
  preset: null,
  stage: null,
  fromGames: null
};

/**
 * The repertoire screens live at /repertoires… (ids in the URL; the rest is App state): the view
 * the URL names, and the study or practice screen it shows with App's extras.
 */
export function useRepertoireRoute() {
  const hubMatch = useMatch("/repertoires");
  const studyMatch = useMatch("/repertoires/:id/chapters/:chapterId");
  const practiceMatch = useMatch("/repertoires/:id/practice/:sessionId?");
  const routeView: AppView | null = studyMatch
    ? "repertoire-study"
    : practiceMatch
      ? "repertoire-practice"
      : hubMatch
        ? "repertoire-hub"
        : null;
  const [extras, setExtras] = useState<RepertoireExtras>(initialRepertoireExtras);

  const studyRepertoireId = studyMatch?.params.id ?? null;
  const studyChapterId = studyMatch?.params.chapterId ?? null;
  const practiceRepertoireId = practiceMatch?.params.id ?? null;
  const practiceSessionId = practiceMatch?.params.sessionId ?? null;
  const screen = useMemo<RepertoireScreen | null>(() => {
    if (studyRepertoireId && studyChapterId) {
      return {
        view: "repertoire-study",
        repertoireId: studyRepertoireId,
        chapterId: studyChapterId,
        nodeId: extras.nodeId,
        orientation: extras.orientation,
        tab: extras.tab,
        stage: extras.stage,
        fromGames: extras.fromGames
      };
    }
    if (practiceRepertoireId) {
      return {
        view: "repertoire-practice",
        repertoireId: practiceRepertoireId,
        sessionId: practiceSessionId,
        preset: extras.preset
      };
    }
    return null;
  }, [studyRepertoireId, studyChapterId, practiceRepertoireId, practiceSessionId, extras]);

  return { routeView, screen, extras, setExtras };
}
