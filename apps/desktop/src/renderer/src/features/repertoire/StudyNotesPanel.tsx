import { useId, type ReactNode } from "react";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { SectionHeader } from "@/components/ui/page";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import { decisionDraftKey, type DecisionTextField } from "./repertoire-model";

/** The longest comment a chapter save keeps (the main process's chapter validation limit). */
const MAX_COMMENT_LENGTH = 20_000;

/** The longest prompt or hint a decision write accepts (the main process's decision validation limit). */
export const MAX_DECISION_TEXT_LENGTH = 2_000;

const FIELD_NAMES: Record<DecisionTextField, string> = { prompt: "prompt", hint: "hint" };

/**
 * Notes for the selected move: its comment (part of the chapter draft, autosaved), and at a
 * position where the player has a decision, the practice prompt and hidden hint (repertoire-wide
 * decision fields). Their typed text lives in the workspace store as a draft until its
 * write is confirmed, so moving to another position or leaving study never drops it; it is saved
 * on blur, and with the chapter draft on navigation or when the window closes. `footer` follows
 * them (the chapter's sources).
 */
export function StudyNotesPanel({
  node,
  repertoireId,
  positionKey,
  decisionText,
  canEditDecision,
  busy,
  onComment,
  onDecisionTextChange,
  onCommitDecisionText,
  footer
}: {
  node: MoveNode;
  repertoireId: string;
  /** The selected position (its unsaved prompt and hint show instead of the stored ones). */
  positionKey: string | null;
  decisionText: { prompt: string | null; hint: string | null } | null;
  /** The player is to move here with at least one accepted move (a decision exists). */
  canEditDecision: boolean;
  busy: boolean;
  onComment: (text: string) => void;
  onDecisionTextChange: (field: DecisionTextField, text: string) => void;
  /** The field lost focus: save its draft (or drop it when it matches the stored text). */
  onCommitDecisionText: (field: DecisionTextField) => void;
  footer?: ReactNode;
}) {
  const commentId = useId();
  const promptId = useId();
  const hintId = useId();
  const comment = node.comment ?? "";
  // Subscribed here, not in the page: typing re-renders only this panel.
  const drafts = {
    prompt: useRepertoireWorkspaceStore((state) =>
      positionKey
        ? state.decisionDrafts[decisionDraftKey(repertoireId, positionKey, "prompt")]
        : undefined
    ),
    hint: useRepertoireWorkspaceStore((state) =>
      positionKey
        ? state.decisionDrafts[decisionDraftKey(repertoireId, positionKey, "hint")]
        : undefined
    )
  };

  const valueOf = (field: DecisionTextField) => drafts[field]?.text ?? decisionText?.[field] ?? "";
  const hintFor = (field: DecisionTextField, fallback: string) => {
    const draft = drafts[field];
    if (valueOf(field).length >= MAX_DECISION_TEXT_LENGTH) {
      return `Limit reached: a ${FIELD_NAMES[field]} keeps up to ${MAX_DECISION_TEXT_LENGTH.toLocaleString()} characters`;
    }
    if (draft?.status === "error") return "Not saved — see the notice above";
    if (draft?.status === "saving") return "Saving…";
    return fallback;
  };

  return (
    <div className="scroll-area -mr-3 grid h-full min-h-0 content-start gap-5 overflow-y-auto pr-3">
      <Field
        label={node.san ? `Comment on ${node.san}` : "Comment on the starting position"}
        htmlFor={commentId}
        hint={
          comment.length >= MAX_COMMENT_LENGTH
            ? `Limit reached: a comment keeps up to ${MAX_COMMENT_LENGTH.toLocaleString()} characters`
            : undefined
        }
      >
        <Textarea
          id={commentId}
          className="min-h-28 font-sans"
          placeholder="Plans, ideas, typical mistakes…"
          maxLength={MAX_COMMENT_LENGTH}
          value={comment}
          onChange={(event) => onComment(event.target.value)}
        />
      </Field>

      <section className="grid gap-3" aria-label="Practice prompt and hint">
        <SectionHeader
          as="h3"
          title="Practice prompt and hint"
          description={
            canEditDecision
              ? "Shared by every occurrence of this position in the repertoire."
              : "Available where you are to move and have accepted at least one move."
          }
        />
        <Field label="Prompt" hint={hintFor("prompt", "Shown during practice")} htmlFor={promptId}>
          <Input
            id={promptId}
            disabled={!canEditDecision || busy}
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
            disabled={!canEditDecision || busy}
            placeholder="e.g. The knight belongs on f3"
            maxLength={MAX_DECISION_TEXT_LENGTH}
            aria-invalid={drafts.hint?.status === "error" || undefined}
            value={valueOf("hint")}
            onChange={(event) => onDecisionTextChange("hint", event.target.value)}
            onBlur={() => onCommitDecisionText("hint")}
          />
        </Field>
      </section>
      {footer}
    </div>
  );
}
