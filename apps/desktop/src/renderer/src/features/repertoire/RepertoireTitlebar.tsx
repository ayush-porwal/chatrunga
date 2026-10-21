import { memo, type ReactNode } from "react";
import { Microscope, Swords } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import { statusForFen } from "@chaturanga/shared/chess/position";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useRepertoireQuery } from "../../queries/repertoire";
import { selectLiveGameInProgress, useLichessStore } from "../../stores/lichess-store";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import { useStudyEngineStore } from "../../stores/study-engine-store";
import { WorkspaceTitlebar } from "../board/BoardWorkspace";
import { LIVE_GAME_NOTICE, NO_MOVES_TO_PLAY } from "./handoffs";
import { decisionTextStatus, saveStatusLabel } from "./repertoire-model";
import { retryDecisionTextsNow, saveChapterDraftNow } from "./useChapterAutosave";

/** The repertoire's name (the sidebar's Repertoire leads back to the hub). */
function RepertoireName({ name }: { name: string | null }) {
  return <span className="truncate font-medium text-fg">{name ?? "Repertoire"}</span>;
}

/**
 * Study titlebar (as Analysis's): the repertoire, the chapter, and the save state of the chapter
 * draft and of the prompts and hints typed in it ("Saved", "Saving…", "Unsaved — <error>") with
 * Retry for a failed save; then the position's actions, Analyze (the engine panel atop the moves)
 * and Play from here. A stale draft's choices (Reload / Keep editing, Discard / Keep mine) are in
 * the panel notices; Retry would only be refused again.
 */
export const RepertoireStudyTitlebar = memo(function RepertoireStudyTitlebar({
  repertoireId,
  onPlayFromHere
}: {
  repertoireId: string;
  /** Unset: no Play from here (the web preview). */
  onPlayFromHere?: () => void;
}) {
  const queryClient = useQueryClient();
  const detail = useRepertoireQuery(repertoireId);
  const { chapterId, chapterTitle, fen, dirty, saveState } = useRepertoireWorkspaceStore(
    useShallow((state) => {
      const open = state.repertoireId === repertoireId ? state.chapter : null;
      return {
        chapterId: open ? state.chapterId : null,
        chapterTitle: open?.title ?? null,
        fen: open?.tree.find((node) => node.id === state.selectedNodeId)?.fenAfter ?? null,
        dirty: state.dirty,
        saveState: state.saveState
      };
    })
  );
  const decisionText = useRepertoireWorkspaceStore(
    useShallow((state) => decisionTextStatus(state.decisionDrafts, repertoireId))
  );
  const engineOpen = useStudyEngineStore(
    (state) => chapterId !== null && state.chapterId === chapterId
  );
  const onlineGameLive = useLichessStore(selectLiveGameInProgress);
  const failed = saveState.status === "error";
  const retryChapter = failed && !saveState.stale;
  const retryText = decisionText.errorMessage !== null && !decisionText.errorStale;
  const unavailable = fen ? positionActionsUnavailable(fen, onlineGameLive) : null;
  return (
    <WorkspaceTitlebar
      title={<RepertoireName name={detail.data?.name ?? null} />}
      meta={chapterTitle}
      status={chapterTitle ? saveStatusLabel({ dirty, saveState, decisionText }) : null}
      statusIsError={failed || decisionText.errorMessage !== null}
      actions={
        <>
          {retryChapter || retryText ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                if (retryChapter) {
                  useRepertoireWorkspaceStore.getState().clearSaveError();
                  void saveChapterDraftNow(queryClient);
                }
                void retryDecisionTextsNow(queryClient, repertoireId);
              }}
            >
              Retry
            </Button>
          ) : null}
          {chapterId && unavailable ? (
            <>
              <TitlebarAction
                label="Analyze"
                icon={<Microscope />}
                tooltip={engineOpen ? "Close the engine" : "Analyze this position with the engine"}
                // The engine panel can always close.
                unavailable={engineOpen ? null : unavailable.analyze}
                pressed={engineOpen}
                onClick={() => useStudyEngineStore.getState().toggle(chapterId)}
              />
              {onPlayFromHere ? (
                <TitlebarAction
                  label="Play from here"
                  icon={<Swords />}
                  tooltip="Play the engine from this position as your repertoire's side"
                  unavailable={unavailable.play}
                  onClick={onPlayFromHere}
                />
              ) : null}
            </>
          ) : null}
        </>
      }
    />
  );
});

/**
 * One titlebar action on the selected position. Unavailable, it stays focusable and hoverable
 * (`aria-disabled`, not `disabled`) so its tooltip can say why; a click then does nothing.
 */
function TitlebarAction({
  label,
  icon,
  tooltip,
  unavailable,
  pressed,
  onClick
}: {
  label: string;
  icon: ReactNode;
  tooltip: string;
  /** Why it can't run now (null: it can). */
  unavailable: string | null;
  /** A toggle's state (Analyze). */
  pressed?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={pressed ? "primary" : "outline"}
          size="sm"
          aria-pressed={pressed}
          aria-disabled={unavailable ? true : undefined}
          className={cn(unavailable && "cursor-not-allowed opacity-50")}
          onClick={unavailable ? undefined : onClick}
        >
          {icon}
          {label}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-64">
        {unavailable ?? tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Why Play from here and the engine can't start at `fen`: a finished position, or a Lichess game
 * being played. Null: they can.
 */
function positionActionsUnavailable(
  fen: string,
  onlineGameLive: boolean
): { play: string | null; analyze: string | null } {
  if (statusForFen(fen).isEnd) return { play: NO_MOVES_TO_PLAY, analyze: NO_MOVES_TO_PLAY };
  if (onlineGameLive) {
    return { play: LIVE_GAME_NOTICE, analyze: "The engine is off during your Lichess game." };
  }
  return { play: null, analyze: null };
}

/** Practice titlebar: the repertoire practised. */
export const RepertoirePracticeTitlebar = memo(function RepertoirePracticeTitlebar({
  repertoireId
}: {
  repertoireId: string;
}) {
  const detail = useRepertoireQuery(repertoireId);
  return (
    <WorkspaceTitlebar
      title={<RepertoireName name={detail.data?.name ?? null} />}
      meta="Practice"
    />
  );
});
