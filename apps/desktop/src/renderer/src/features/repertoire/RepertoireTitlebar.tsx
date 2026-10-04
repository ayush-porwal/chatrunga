import { memo } from "react";
import { ChevronRight } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { useRepertoireQuery } from "../../queries/repertoire";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import { WorkspaceTitlebar } from "../board/BoardWorkspace";
import { decisionTextStatus, saveStatusLabel } from "./repertoire-model";
import { retryDecisionTextsNow, saveChapterDraftNow } from "./useChapterAutosave";

/** "Repertoire › My White repertoire › Italian" with links back to the hub. */
function Crumbs({
  name,
  chapterTitle,
  onHub
}: {
  name: string | null;
  chapterTitle?: string | null;
  onHub: () => void;
}) {
  return (
    <nav
      aria-label="Repertoire location"
      className="flex min-w-0 items-center gap-1 text-sm [-webkit-app-region:no-drag]"
    >
      <Button type="button" variant="link" size="xs" className="text-sm" onClick={onHub}>
        Repertoire
      </Button>
      {name ? (
        <>
          <ChevronRight className="size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
          <span
            className={chapterTitle ? "truncate text-fg-muted" : "truncate font-medium text-fg"}
          >
            {name}
          </span>
        </>
      ) : null}
      {chapterTitle ? (
        <>
          <ChevronRight className="size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
          <span className="truncate font-medium text-fg">{chapterTitle}</span>
        </>
      ) : null}
    </nav>
  );
}

/**
 * Study titlebar: where you are, and the save state of the chapter draft and of the prompts and
 * hints typed in it ("Saved", "Saving…", "Unsaved — <error>") with Retry for a failed save. A
 * stale draft's choices (Reload / Keep editing, Discard / Keep mine) are in the panel notices;
 * Retry would only be refused again.
 */
export const RepertoireStudyTitlebar = memo(function RepertoireStudyTitlebar({
  repertoireId,
  onHub
}: {
  repertoireId: string;
  onHub: () => void;
}) {
  const queryClient = useQueryClient();
  const detail = useRepertoireQuery(repertoireId);
  const { chapterTitle, dirty, saveState } = useRepertoireWorkspaceStore(
    useShallow((state) => ({
      chapterTitle: state.repertoireId === repertoireId ? (state.chapter?.title ?? null) : null,
      dirty: state.dirty,
      saveState: state.saveState
    }))
  );
  const decisionText = useRepertoireWorkspaceStore(
    useShallow((state) => decisionTextStatus(state.decisionDrafts, repertoireId))
  );
  const failed = saveState.status === "error";
  const retryChapter = failed && !saveState.stale;
  const retryText = decisionText.errorMessage !== null && !decisionText.errorStale;
  return (
    <WorkspaceTitlebar
      title={<Crumbs name={detail.data?.name ?? null} chapterTitle={chapterTitle} onHub={onHub} />}
      status={chapterTitle ? saveStatusLabel({ dirty, saveState, decisionText }) : null}
      statusIsError={failed || decisionText.errorMessage !== null}
      actions={
        retryChapter || retryText ? (
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
        ) : null
      }
    />
  );
});

/** Practice titlebar: where you are. */
export const RepertoirePracticeTitlebar = memo(function RepertoirePracticeTitlebar({
  repertoireId,
  onHub
}: {
  repertoireId: string;
  onHub: () => void;
}) {
  const detail = useRepertoireQuery(repertoireId);
  return (
    <WorkspaceTitlebar
      title={<Crumbs name={detail.data?.name ?? null} chapterTitle="Practice" onHub={onHub} />}
    />
  );
});
