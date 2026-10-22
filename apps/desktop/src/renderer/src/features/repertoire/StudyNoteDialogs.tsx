import { useId } from "react";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type { RepertoireDecision } from "@chaturanga/shared/types/repertoire";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import {
  DECISION_SCOPE_TEXT,
  MAX_DECISION_TEXT_LENGTH,
  decisionDraftKey,
  type DecisionTextDraft,
  type DecisionTextField
} from "./repertoire-model";
import { WrongMoveFeedback } from "./WrongMoveFeedback";

/** The longest comment a chapter save keeps (the main process's chapter validation limit). */
const MAX_COMMENT_LENGTH = 20_000;

const FIELD_NAMES: Record<DecisionTextField, string> = { prompt: "prompt", hint: "hint" };

/**
 * "Edit comment…": the selected move's comment (the starting position's at the root), part of the
 * chapter draft and autosaved as it is typed. The tree shows it under the move.
 */
export function StudyCommentDialog({
  node,
  onComment,
  onClose
}: {
  node: MoveNode;
  onComment: (text: string) => void;
  onClose: () => void;
}) {
  const id = useId();
  const comment = node.comment ?? "";
  return (
    <Dialog
      size="sm"
      title={node.san ? `Comment on ${node.san}` : "Comment on the starting position"}
      onClose={onClose}
      footer={
        <Button type="button" variant="primary" size="sm" onClick={onClose}>
          Done
        </Button>
      }
    >
      <Field
        label={node.san ? `Comment on ${node.san}` : "Comment on the starting position"}
        htmlFor={id}
        hint={
          comment.length >= MAX_COMMENT_LENGTH
            ? `Limit reached: a comment keeps up to ${MAX_COMMENT_LENGTH.toLocaleString()} characters`
            : "Saved as you type"
        }
      >
        <Textarea
          id={id}
          autoFocus
          className="min-h-32 font-sans"
          placeholder="Plans, ideas, typical mistakes…"
          maxLength={MAX_COMMENT_LENGTH}
          value={comment}
          onChange={(event) => onComment(event.target.value)}
        />
      </Field>
    </Dialog>
  );
}

/**
 * "Edit hint & prompt…" at a position where the player has a decision: the practice prompt and
 * hidden hint, and wrong-move feedback (repertoire-wide decision fields: every occurrence and
 * transposition shares them). Their typed text lives in the workspace store as a draft until its
 * write is confirmed, so moving on never drops it; a field is saved on blur, and every draft of the
 * position when the dialog closes (`onCommitAll`).
 */
export function StudyDecisionDialog({
  node,
  repertoireId,
  positionKey,
  decision,
  busy,
  onDecisionTextChange,
  onCommitDecisionText,
  onFeedbackChange,
  onCommitFeedback,
  onClose
}: {
  node: MoveNode;
  repertoireId: string;
  positionKey: string;
  decision: RepertoireDecision | null;
  busy: boolean;
  onDecisionTextChange: (field: DecisionTextField, text: string) => void;
  /** The field lost focus (or the dialog closed): save its draft, or drop one matching the stored text. */
  onCommitDecisionText: (field: DecisionTextField) => void;
  onFeedbackChange: (uci: string, text: string) => void;
  onCommitFeedback: (uci: string) => void;
  onClose: () => void;
}) {
  const promptId = useId();
  const hintId = useId();
  // Subscribed here, not in the page: typing re-renders only this dialog.
  const drafts = {
    prompt: useRepertoireWorkspaceStore(
      (state): DecisionTextDraft | undefined =>
        state.decisionDrafts[decisionDraftKey(repertoireId, positionKey, "prompt")]
    ),
    hint: useRepertoireWorkspaceStore(
      (state): DecisionTextDraft | undefined =>
        state.decisionDrafts[decisionDraftKey(repertoireId, positionKey, "hint")]
    )
  };
  const valueOf = (field: DecisionTextField) => drafts[field]?.text ?? decision?.[field] ?? "";
  const hintFor = (field: DecisionTextField, fallback: string) => {
    const draft = drafts[field];
    if (valueOf(field).length >= MAX_DECISION_TEXT_LENGTH) {
      return `Limit reached: a ${FIELD_NAMES[field]} keeps up to ${MAX_DECISION_TEXT_LENGTH.toLocaleString()} characters`;
    }
    if (draft?.status === "error") return "Not saved — see the notice in the panel";
    if (draft?.status === "saving") return "Saving…";
    return fallback;
  };
  // Escape closes without a blur: every field of the position is committed here too.
  const close = () => {
    onCommitDecisionText("prompt");
    onCommitDecisionText("hint");
    for (const draft of Object.values(useRepertoireWorkspaceStore.getState().decisionDrafts)) {
      if (
        draft.repertoireId === repertoireId &&
        draft.positionKey === positionKey &&
        draft.field === "feedback" &&
        draft.uci
      ) {
        onCommitFeedback(draft.uci);
      }
    }
    onClose();
  };

  return (
    <Dialog
      title={node.san ? `Practice after ${node.san}` : "Practice at the start"}
      description={DECISION_SCOPE_TEXT}
      onClose={close}
      bodyClassName="grid gap-5"
      footer={
        <Button type="button" variant="primary" size="sm" onClick={close}>
          Done
        </Button>
      }
    >
      <div className="grid gap-3">
        <Field label="Prompt" hint={hintFor("prompt", "Shown during practice")} htmlFor={promptId}>
          <Input
            id={promptId}
            autoFocus
            disabled={busy}
            placeholder="e.g. Develop with tempo"
            maxLength={MAX_DECISION_TEXT_LENGTH}
            aria-invalid={drafts.prompt?.status === "error" || undefined}
            value={valueOf("prompt")}
            onChange={(event) => onDecisionTextChange("prompt", event.target.value)}
            onBlur={() => onCommitDecisionText("prompt")}
          />
        </Field>
        <Field label="Hint" hint={hintFor("hint", "Hidden until asked for")} htmlFor={hintId}>
          <Input
            id={hintId}
            disabled={busy}
            placeholder="e.g. The knight belongs on f3"
            maxLength={MAX_DECISION_TEXT_LENGTH}
            aria-invalid={drafts.hint?.status === "error" || undefined}
            value={valueOf("hint")}
            onChange={(event) => onDecisionTextChange("hint", event.target.value)}
            onBlur={() => onCommitDecisionText("hint")}
          />
        </Field>
      </div>
      <WrongMoveFeedback
        // A move and text picked for "Add feedback" belong to this position only.
        key={positionKey}
        repertoireId={repertoireId}
        positionKey={positionKey}
        fen={node.fenAfter}
        decision={decision}
        canEditDecision
        busy={busy}
        onFeedbackChange={onFeedbackChange}
        onCommitFeedback={onCommitFeedback}
      />
    </Dialog>
  );
}
