import type { Dispatch, SetStateAction } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { Color } from "@chaturanga/shared/types/chess";
import type { RepertoireHubTab } from "@chaturanga/shared/types/repertoire-practice";
import {
  REPERTOIRE_ROOT_NODE_ID,
  type RepertoireDetail
} from "@chaturanga/shared/types/repertoire";
import { rememberCollapsibleOpen } from "@/components/ui/collapsible-section";
import type { OpeningSide } from "../features/game-review/opening-comparison";
import {
  buildInitialSession,
  handoffAtEnd,
  NO_MOVES_TO_PLAY,
  repertoireCommandBlocked,
  reviewOpeningAfterFlush,
  type HandoffOrigin,
  type RepertoireCommand
} from "../features/repertoire/handoffs";
import { practiceAutoStarts } from "../features/repertoire/practice-start";
import type { InsightsReviewTarget } from "../features/repertoire/insights/insights-actions";
import {
  mainlineNodeAtPly,
  useInsightsReturnStore
} from "../features/repertoire/insights/insights-return";
import type { StudyOpenTarget } from "../features/repertoire/repertoire-chapters";
import type { StudyTab } from "../features/repertoire/RepertoireStudyPage";
import {
  flushChapterDraft,
  unsavedDecisionMessage,
  unsavedStudyCause
} from "../features/repertoire/useChapterAutosave";
import type { useUpdateSettingMutation } from "../queries/api";
import { repertoireKeys } from "../queries/repertoire";
import { useAnalysisStore } from "../stores/analysis-store";
import { useAppNoticeStore } from "../stores/app-notice-store";
import { useGameStore } from "../stores/game-store";
import { useLichessStore } from "../stores/lichess-store";
import { usePlayDraftStore } from "../stores/play-draft-store";
import { useRepertoireHandoffStore } from "../stores/repertoire-handoff-store";
import { useRepertoirePracticeStore } from "../stores/repertoire-practice-store";
import { useRepertoireWorkspaceStore } from "../stores/repertoire-workspace-store";
import type { AppView, RepertoireScreen } from "./AppPages";
import { boardViews, currentGame, repertoireViews, type AppNavigation } from "./app-navigation";
import type { BoardCommands } from "./board-commands";
import type { HistoryMode } from "./history-navigation";
import { saveStudyDraftFirst } from "./navigation-coordinator";
import { flushGameAutosave } from "./useGameAutosave";
import type { RepertoireExtras } from "./useRepertoireRoute";

/**
 * What App keeps for a study screen opened at `target`. A staged move is applied once by the
 * study page; history entries never carry it (nor the From your games banner). A reply the
 * user's games show unprepared is staged at its node.
 */
function studyExtras(
  target: Omit<StudyOpenTarget, "tab"> & { orientation?: Color | null },
  tab: StudyTab
): RepertoireExtras {
  const fromGames = target.fromGames ?? null;
  const unprepared =
    fromGames?.kind === "unprepared" && target.nodeId
      ? { nodeId: target.nodeId, uci: fromGames.reply.uci }
      : null;
  return {
    nodeId: target.nodeId,
    orientation: target.orientation ?? null,
    tab,
    preset: null,
    stage: target.stage ?? unprepared,
    fromGames
  };
}

/** What the repertoire commands need from the shell besides its navigation. */
type RepertoireCommandDeps = {
  queryClient: QueryClient;
  /** The repertoire screen the route shows (with App's extras), and those extras. */
  screen: RepertoireScreen | null;
  extras: RepertoireExtras;
  setExtras: Dispatch<SetStateAction<RepertoireExtras>>;
  openGameReview: BoardCommands["openSelectedGameReview"];
  updateSetting: ReturnType<typeof useUpdateSettingMutation>["mutate"];
  setOpeningSide: (side: OpeningSide | null) => void;
};

/**
 * The repertoire screens (hub, study, practice) and the handoffs between them and the board.
 * The repertoire screens never load anything into the game store: the game (and an engine game
 * still being played) stays as it is behind them.
 *
 * Not a React hook (it calls none): it rebuilds its commands every render like the nested functions
 * it replaced, and takes the use- name only because the React Compiler's lint (react/refs) lets a
 * hook, not a plain function, receive the shell's refs during render.
 */
export function useRepertoireCommands(nav: AppNavigation, deps: RepertoireCommandDeps) {
  const { latestNavigation, commitCurrent, record } = nav;
  const { queryClient, screen } = deps;

  /** Shows a repertoire screen at `path`; the route change is part of the same view transition. */
  function showRepertoireView(view: AppView, path: string) {
    // Live analysis stops; a review of the game behind keeps running (Back to it shows its progress).
    // Study's engine panel stops its own search (closed, Study left, another chapter): while it is
    // open the engine already searches the study, not the board, and another visit to the same
    // chapter (Back, a transposition) keeps it running.
    const studyEngineOpen = useAnalysisStore.getState().target !== null;
    if (useGameStore.getState().mode !== "engine" && !studyEngineOpen)
      nav.stopEngineWork({ keepReview: true });
    if (!boardViews.has(view) || !repertoireViews.has(nav.view)) nav.setFocusMode(false);
    nav.setView(view, () => void nav.navigate(path, { replace: true }));
  }

  /** The hub, on `tab` when given (it becomes the remembered tab), else the one last shown. */
  function openRepertoireHub(history: HistoryMode = "push", tab?: RepertoireHubTab) {
    if (tab) deps.updateSetting({ key: "repertoireHubTab", value: tab });
    if (history === "push") commitCurrent();
    latestNavigation.current += 1;
    showRepertoireView("repertoire-hub", "/repertoires");
    record(history, { view: "repertoire-hub" });
  }

  /**
   * Study at a chapter (and node). Leaving another chapter's draft saves it first; when that save
   * fails the draft stays open with its error (false). A newer navigation meanwhile wins (false).
   */
  async function openRepertoireStudy(
    target: Omit<StudyOpenTarget, "tab"> & { tab?: StudyTab; orientation?: Color | null },
    history: HistoryMode = "push"
  ): Promise<boolean> {
    if (history === "push") commitCurrent();
    const request = ++latestNavigation.current;
    const draft = useRepertoireWorkspaceStore.getState();
    // Only the study page being left can hold this back with its repertoire's unsaved decision
    // changes (the one opened lists its own on its chapter). A study left earlier (for the hub,
    // say) keeps its changes, with Retry and Discard, on its own page.
    const studying = studyOnScreen();
    const leaving = studying && studying !== target.repertoireId ? studying : null;
    const leftSaved = await saveStudyDraftFirst({
      request,
      navigation: latestNavigation,
      flush: () => flushChapterDraft(queryClient, leaving ? [leaving] : []),
      failure: () =>
        studyFailure(
          leaving,
          "the chapter",
          "This chapter couldn't be saved; retry the save before opening another one."
        ),
      keepChapterId: target.chapterId
    });
    if (!leftSaved) return false;
    // Restoring the chapter already open: put its node (no node is the root) and orientation
    // back directly. Back / Forward asked about the staged moves first (confirmLeavingStaged):
    // they go now that the restore goes ahead.
    if (draft.repertoireId === target.repertoireId && draft.chapterId === target.chapterId) {
      if (history !== "push") draft.discardStaged();
      draft.selectNode(target.nodeId ?? REPERTOIRE_ROOT_NODE_ID);
      if (target.orientation) draft.setOrientation(target.orientation);
    }
    const tab = target.tab ?? deps.extras.tab;
    deps.setExtras(studyExtras(target, tab));
    showRepertoireView(
      "repertoire-study",
      `/repertoires/${encodeURIComponent(target.repertoireId)}/chapters/${encodeURIComponent(target.chapterId)}`
    );
    record(history, {
      view: "repertoire-study",
      repertoireId: target.repertoireId,
      chapterId: target.chapterId,
      nodeId: target.nodeId,
      tab,
      orientation: target.orientation ?? null
    });
    return true;
  }

  /**
   * Practice: a session to resume, else one that starts at once (the preset's, or with the
   * repertoire's practice settings). Each navigation carries its own preset, recorded with its
   * history entry, so it starts once: a restore passes it back and is shown that start's answer.
   * Another Practice while this repertoire's start is still waiting for its answer (a double click)
   * leaves that start alone. A study draft still saving (left through the hub, say) is saved first,
   * so practice grades the edited chapter; when that save fails, the notice says so and the
   * current screen stays (false, as when a newer navigation wins).
   */
  async function openRepertoirePractice(
    repertoireId: string,
    {
      sessionId = null,
      preset = null
    }: { sessionId?: string | null; preset?: RepertoireExtras["preset"] } = {},
    history: HistoryMode = "push"
  ): Promise<boolean> {
    if (history === "push" && !sessionId && practiceStarting(repertoireId)) return true;
    if (history === "push") commitCurrent();
    const request = ++latestNavigation.current;
    // Held back by the study page being left and by this repertoire's unsaved changes (practice
    // shows its prompts and hints, and pauses), not by another repertoire's.
    const studying = studyOnScreen();
    const blockOn =
      studying && studying !== repertoireId ? [studying, repertoireId] : [repertoireId];
    const leftSaved = await saveStudyDraftFirst({
      request,
      navigation: latestNavigation,
      flush: () => flushChapterDraft(queryClient, blockOn),
      failure: () =>
        studyFailure(
          blockOn.find((id) => unsavedStudyCause(id) !== null) ?? null,
          "practice",
          "This chapter couldn't be saved; reopen it and retry the save before practising."
        )
    });
    if (!leftSaved) return false;
    const navigation = sessionId ? null : (preset ?? {});
    deps.setExtras((extras) => ({ ...extras, preset: navigation }));
    showRepertoireView("repertoire-practice", practicePath(repertoireId, sessionId));
    record(history, { view: "repertoire-practice", repertoireId, sessionId, preset: navigation });
    return true;
  }

  /** This repertoire's practice is on screen, its start still waiting for its answer. */
  function practiceStarting(repertoireId: string): boolean {
    return (
      screen?.view === "repertoire-practice" &&
      screen.repertoireId === repertoireId &&
      screen.sessionId === null &&
      screen.preset !== null &&
      practiceAutoStarts.pending(screen.preset)
    );
  }

  /** The session started: same screen, now naming the session (never one already named). */
  function practiceSessionStarted(sessionId: string) {
    if (screen?.view !== "repertoire-practice" || screen.sessionId !== null) return;
    const { repertoireId } = screen;
    void nav.navigate(practicePath(repertoireId, sessionId), { replace: true });
    record("replace", { view: "repertoire-practice", repertoireId, sessionId });
  }

  /** "Practice again" / "Start a new session": a new session as a new step. */
  function practiceAgain() {
    if (screen?.view !== "repertoire-practice") return;
    useRepertoirePracticeStore.getState().reset();
    void openRepertoirePractice(screen.repertoireId);
  }

  // ---- Repertoire handoffs (Study → Play from here) and the Lichess guard ----------------------

  /**
   * Runs a repertoire command unless a Lichess game being played would lose the screen to it; then
   * the board comes back with the notice instead (see unlessOnlineGame). Decided by the live game
   * state now, not by an earlier finish event.
   */
  function unlessRepertoireBlocked(command: RepertoireCommand, action: () => void) {
    if (!repertoireCommandBlocked(useLichessStore.getState(), command)) return action();
    nav.unlessOnlineGame(action);
  }

  /** The open study chapter and selected node as a handoff's origin (null when none is loaded). */
  function studyHandoffOrigin(): HandoffOrigin | null {
    if (screen?.view !== "repertoire-study") return null;
    const draft = useRepertoireWorkspaceStore.getState();
    if (
      !draft.chapter ||
      draft.repertoireId !== screen.repertoireId ||
      draft.chapterId !== screen.chapterId
    ) {
      return null;
    }
    const detail = queryClient.getQueryData<RepertoireDetail>(
      repertoireKeys.detail(screen.repertoireId)
    );
    return {
      repertoireId: screen.repertoireId,
      repertoireName: detail?.name ?? "Repertoire",
      color: draft.color,
      chapter: draft.chapter,
      nodeId: draft.selectedNodeId
    };
  }

  /**
   * Saves the study draft before a handoff leaves it. When it can't be saved the draft stays open
   * with its edits and the notice offers Retry (dismissing it stays on the chapter). False also
   * when a newer navigation (a Lichess game starting, say) took over meanwhile.
   */
  async function flushStudyForHandoff(
    request: number,
    action: string,
    retry: () => void
  ): Promise<boolean> {
    // Only the chapter's own repertoire holds the handoff back: another repertoire's unsaved
    // prompt or hint is written too, and waits on its own chapter when that fails.
    const repertoireId = useRepertoireWorkspaceStore.getState().repertoireId;
    const saved = await flushChapterDraft(queryClient, repertoireId ? [repertoireId] : []);
    if (request !== latestNavigation.current) return false;
    if (saved) return true;
    const cause = unsavedStudyCause(repertoireId);
    // Refused as stale: Retry would be refused again; the chapter's notice asks Keep mine or Discard.
    if (cause === "stale-decision") {
      useAppNoticeStore.getState().show(unsavedDecisionMessage(true, action));
      return false;
    }
    useAppNoticeStore
      .getState()
      .show(
        cause === "decision"
          ? unsavedDecisionMessage(false, action)
          : `This chapter couldn't be saved, so ${action} didn't open. Your edits are kept: retry, ` +
              "or dismiss to stay and keep editing.",
        {
          action: {
            label: "Retry",
            onSelect: () => {
              useRepertoireWorkspaceStore.getState().clearSaveError();
              retry();
            }
          }
        }
      );
    return false;
  }

  /** The repertoire whose study page is on screen (null on any other screen). */
  function studyOnScreen(): string | null {
    return screen?.view === "repertoire-study" ? screen.repertoireId : null;
  }

  /**
   * A navigation's notice when the study draft it leaves stayed unsaved: the chapter's own
   * (`chapterMessage`), or the repertoire's prompt, hint or other decision change.
   */
  function studyFailure(repertoireId: string | null, action: string, chapterMessage: string) {
    const cause = unsavedStudyCause(repertoireId);
    if (cause === "decision" || cause === "stale-decision") {
      return unsavedDecisionMessage(cause === "stale-decision", action);
    }
    return chapterMessage;
  }

  /**
   * The study's handoff origin once its draft is saved, or null with the reason shown: a Lichess
   * game that started meanwhile keeps the board (read again now, with its notice), the chapter is
   * no longer loaded, or its position is over.
   */
  function handoffOriginAfterFlush(
    command: RepertoireCommand,
    action: string
  ): HandoffOrigin | null {
    if (repertoireCommandBlocked(useLichessStore.getState(), command)) {
      nav.unlessOnlineGame(() => {
        // Never runs: the live game blocks the command; this shows it, with its notice.
      });
      return null;
    }
    const origin = studyHandoffOrigin();
    if (!origin) {
      useAppNoticeStore.getState().show(`The chapter isn't loaded, so ${action} didn't open.`);
      return null;
    }
    if (handoffAtEnd(origin)) {
      useAppNoticeStore.getState().show(`${NO_MOVES_TO_PLAY}.`, { tone: "info" });
      return null;
    }
    return origin;
  }

  /**
   * Study → Play from here: Play's engine setup with the selected position, its route and the
   * repertoire's colour (untimed unless a clock is picked). Back returns to the chapter. `retry`
   * is what the notice's Retry runs when the chapter couldn't be saved first.
   */
  async function playFromStudy(retry: () => void) {
    if (!nav.desktopApiAvailable) return;
    const request = ++latestNavigation.current;
    if (!(await flushStudyForHandoff(request, "Play from here", retry))) return;
    const origin = handoffOriginAfterFlush("play-from-here", "Play from here");
    if (!origin) return;
    usePlayDraftStore.getState().setInitialSession(buildInitialSession(origin));
    useLichessStore.getState().setPlayOpponent("engine");
    nav.openPlayPage();
  }

  /** After a game played from a repertoire: the chapter and position it started from. */
  function returnToRepertoire() {
    const played = useRepertoireHandoffStore.getState().played;
    if (!played) return;
    void openRepertoireStudy({
      repertoireId: played.repertoireId,
      chapterId: played.chapterId,
      nodeId: played.nodeId
    });
  }

  /**
   * After a game played from a repertoire: Game review on the Opening tab, comparing as the
   * repertoire's colour against that repertoire (remembered for the colour, like a pick there).
   */
  async function reviewHandoffOpening() {
    if (!useRepertoireHandoffStore.getState().played) return;
    const request = ++latestNavigation.current;
    // The game's library id (its first save may still be waiting) names the review route.
    await flushGameAutosave();
    const played = useRepertoireHandoffStore.getState().played;
    const decision = reviewOpeningAfterFlush({
      request,
      latestRequest: latestNavigation.current,
      liveState: useLichessStore.getState(),
      played,
      gameId: currentGame().gameId
    });
    if (decision === "blocked") {
      nav.unlessOnlineGame(() => {
        // Never runs: the live game blocks the review; this shows it, with its notice.
      });
    }
    if (decision === "gone") {
      useAppNoticeStore
        .getState()
        .show("That game is no longer on the board, so its opening wasn't reviewed.");
    }
    if (decision !== "go" || !played) return;
    deps.updateSetting({
      key: played.color === "white" ? "repertoireCompareWhite" : "repertoireCompareBlack",
      value: played.repertoireId
    });
    deps.setOpeningSide({ board: currentGame().board, color: played.color });
    // The comparison is in the summary's OPENING section: shown unfolded.
    rememberCollapsibleOpen("review-summary:repertoire", true);
    await deps.openGameReview("current", "summary");
  }

  // ---- Insights → Game review, and back ---------------------------------------------------------

  /**
   * Insights' Review game: Game review of a library game at the move a report row or listed game is
   * about, comparing with its repertoire on the Opening section; the titlebar offers Back to
   * Insights while that game is shown.
   */
  async function reviewFromInsights(target: InsightsReviewTarget) {
    const { repertoireId, color } = target;
    if (repertoireId && color) {
      deps.updateSetting({
        key: color === "white" ? "repertoireCompareWhite" : "repertoireCompareBlack",
        value: repertoireId
      });
    }
    rememberCollapsibleOpen("review-summary:repertoire", true);
    await deps.openGameReview(target.gameId, "summary");
    // A newer navigation, or the game couldn't be read: nothing more to show.
    if (currentGame().gameId !== target.gameId) return;
    useInsightsReturnStore.getState().setGameId(target.gameId, target.focus);
    if (color) deps.setOpeningSide({ board: currentGame().board, color });
    // The position where the move was played: the band and the board's arrows are about it.
    const node = target.ply === null ? null : mainlineNodeAtPly(currentGame().moveTree, target.ply);
    if (node) currentGame().goToNode(node.parentId ?? node.id);
  }

  /** Game review's Back to Insights: the Repertoire page (on its Insights tab). */
  function backToInsights() {
    useInsightsReturnStore.getState().setGameId(null);
    openRepertoireHub("push", "insights");
  }

  return {
    openRepertoireHub,
    openRepertoireStudy,
    openRepertoirePractice,
    practiceSessionStarted,
    practiceAgain,
    unlessRepertoireBlocked,
    playFromStudy,
    returnToRepertoire,
    reviewHandoffOpening,
    reviewFromInsights,
    backToInsights
  };
}

export type RepertoireCommands = ReturnType<typeof useRepertoireCommands>;

/** The practice route: a new session, or the one it names. */
function practicePath(repertoireId: string, sessionId: string | null): string {
  const base = `/repertoires/${encodeURIComponent(repertoireId)}/practice`;
  return sessionId ? `${base}/${encodeURIComponent(sessionId)}` : base;
}
