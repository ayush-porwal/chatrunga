import { useQueryClient } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";
import type { ChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { useEventCallback } from "@/lib/use-event-callback";
import type { useRepertoireChapterQuery, useRepertoireQuery } from "../../queries/repertoire";
import { playUci, useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import {
  decisionDraftKey,
  decisionDraftName,
  pathLabel,
  type DecisionTextDraft
} from "./repertoire-model";
import {
  discardDecisionText,
  keepDecisionTextNow,
  saveDecisionTextNow
} from "./useChapterAutosave";
import type { LineDeletion } from "./useMoveTreeEditing";

const workspace = () => useRepertoireWorkspaceStore.getState();

/**
 * The open chapter's autosave failure: Retry, or, when the repertoire changed elsewhere, Reload
 * (the saved version) or Keep editing (the next save replaces it).
 */
export function ChapterSaveNotice({
  detail,
  chapterQuery
}: {
  detail: ReturnType<typeof useRepertoireQuery>;
  chapterQuery: ReturnType<typeof useRepertoireChapterQuery>;
}) {
  const saveState = useRepertoireWorkspaceStore((state) => state.saveState);
  const reload = useEventCallback(async () => {
    const [nextDetail, nextChapter] = await Promise.all([detail.refetch(), chapterQuery.refetch()]);
    if (nextDetail.data && nextChapter.data) {
      workspace().loadChapter(nextDetail.data, nextChapter.data, {
        nodeId: workspace().selectedNodeId,
        orientation: workspace().orientation
      });
    }
  });
  const keepEditing = useEventCallback(async () => {
    const [nextDetail, nextChapter] = await Promise.all([detail.refetch(), chapterQuery.refetch()]);
    if (nextDetail.data) {
      const stored = nextChapter.data?.id === workspace().chapterId ? nextChapter.data : null;
      workspace().adoptRevision(nextDetail.data.revision, stored?.revision);
    }
    workspace().clearSaveError();
  });

  if (saveState.status !== "error") return null;
  return (
    <Notice
      tone={saveState.stale ? "warn" : "danger"}
      title={saveState.stale ? "This repertoire changed elsewhere" : "Couldn't save the chapter"}
      action={
        <div className="flex gap-2">
          {saveState.stale ? (
            <>
              <Button type="button" variant="outline" size="xs" onClick={() => void reload()}>
                Reload
              </Button>
              <Button
                type="button"
                variant="outline"
                size="xs"
                title="Keep your draft; the next save replaces the newer version"
                onClick={() => void keepEditing()}
              >
                Keep editing
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => workspace().clearSaveError()}
            >
              Retry
            </Button>
          )}
        </div>
      }
    >
      {saveState.stale
        ? "Reload to see the saved version (your unsaved edits are dropped), or keep editing to save yours over it."
        : saveState.message}
    </Notice>
  );
}

/** One notice per decision write of this repertoire that failed (at any position). */
export function FailedDecisionNotices({
  repertoireId,
  lookup
}: {
  repertoireId: string;
  lookup: ChapterLookup;
}) {
  const failedDrafts = useRepertoireWorkspaceStore(
    useShallow((state) =>
      Object.values(state.decisionDrafts).filter(
        (draft) => draft.repertoireId === repertoireId && draft.status === "error"
      )
    )
  );
  return failedDrafts.map((failed) => {
    const key = decisionDraftKey(failed.repertoireId, failed.positionKey, failed.field, failed.uci);
    return <FailedDecisionNotice key={key} draftKey={key} failed={failed} lookup={lookup} />;
  });
}

/** A failed decision write: Retry (or Keep mine, when stale) and Discard. */
function FailedDecisionNotice({
  draftKey,
  failed,
  lookup
}: {
  draftKey: string;
  failed: DecisionTextDraft;
  lookup: ChapterLookup;
}) {
  const queryClient = useQueryClient();
  const stale = Boolean(failed.error?.stale);
  // Its move was undone or its line deleted: kept for when the move comes back.
  const missing = Boolean(failed.error?.missing);
  const { name, where } = failedDraftPlace(failed, lookup);
  return (
    <Notice
      tone={stale ? "warn" : "danger"}
      title={
        stale
          ? "This repertoire changed elsewhere"
          : missing
            ? `The ${name} has no position to be saved at`
            : `Couldn't save the ${name}${where}`
      }
      action={
        <div className="flex gap-2">
          {stale ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              title={`Save your ${name} over the newer version`}
              onClick={() => void keepDecisionTextNow(queryClient, draftKey)}
            >
              Keep mine
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => void saveDecisionTextNow(queryClient, draftKey)}
            >
              Retry
            </Button>
          )}
          <Button
            type="button"
            variant="link"
            size="xs"
            title={`Drop the typed ${name}; the saved one shows again`}
            onClick={() => discardDecisionText(queryClient, draftKey)}
          >
            Discard
          </Button>
        </div>
      }
    >
      {stale
        ? `Your ${name}${where} wasn't saved. Discard it to see the saved version, or keep yours to save it over that.`
        : missing
          ? `${failed.error?.message} Your ${name} is kept: put the move back (Redo) and retry, or discard it.`
          : failed.error?.message}
    </Notice>
  );
}

/**
 * What a failed draft is called (its feedback's move named when this chapter reaches it) and
 * where it was typed (" at <route>", or "" when this chapter doesn't reach that position).
 */
function failedDraftPlace(
  failed: DecisionTextDraft,
  lookup: ChapterLookup
): { name: string; where: string } {
  const at = [...lookup.positionKeys].find(([, keyAt]) => keyAt === failed.positionKey);
  const where = at ? ` at ${pathLabel(lookup, at[0])}` : "";
  const fenAt = at ? lookup.nodesById.get(at[0])?.fenAfter : undefined;
  const name = decisionDraftName(
    failed,
    fenAt && failed.uci ? playUci(fenAt, failed.uci)?.san : undefined
  );
  return { name, where };
}

/** A later read of the repertoire or chapter failed: the draft stays, with Retry. */
export function LoadErrorNotice({
  loadError,
  onRetry
}: {
  loadError: string | null;
  onRetry: () => void;
}) {
  if (loadError === null) return null;
  return (
    <Notice
      tone="danger"
      title="Couldn't read this repertoire again"
      action={
        <Button type="button" variant="outline" size="xs" onClick={onRetry}>
          Retry
        </Button>
      }
    >
      {`${loadError} Your draft is kept.`}
    </Notice>
  );
}

/** A study command's failure, else the page's own (`localError`), until dismissed. */
export function StudyErrorNotice({
  commandError,
  localError,
  onDismiss
}: {
  commandError: string | null;
  localError: string | null;
  onDismiss: () => void;
}) {
  if (!commandError && !localError) return null;
  return (
    <Notice
      tone="danger"
      action={
        <Button type="button" variant="link" size="xs" onClick={onDismiss}>
          Dismiss
        </Button>
      }
    >
      {commandError ?? localError}
    </Notice>
  );
}

/** "Deleted the line from …", with Undo, while undoing it is the last step. */
export function DeletedLineNotice({ deletion }: { deletion: LineDeletion }) {
  if (deletion.undoableLabel === null) return null;
  return (
    <Notice
      tone="info"
      action={
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="xs" onClick={deletion.undo}>
            Undo
          </Button>
          <Button type="button" variant="link" size="xs" onClick={deletion.dismiss}>
            Dismiss
          </Button>
        </div>
      }
    >
      Deleted the line from {deletion.undoableLabel}.
    </Notice>
  );
}
