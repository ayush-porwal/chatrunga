import { useId, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import type { RepertoireDecision } from "@chaturanga/shared/types/repertoire";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input, Select } from "@/components/ui/input";
import { SectionHeader } from "@/components/ui/page";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import { playUci } from "./study-staging";
import {
  DECISION_SCOPE_TEXT,
  MAX_DECISION_TEXT_LENGTH,
  wrongMoveOptions,
  type DecisionTextDraft
} from "./repertoire-model";

type DecisionPracticeFields = Pick<RepertoireDecision, "acceptedUcis" | "wrongMoveFeedback">;

/**
 * Wrong-move feedback for the decision at the selected position: what practice says after a
 * specific move outside the repertoire. Like the prompt and hint, it is stored once per position
 * (every occurrence and transposition shares it) and changes through decision drafts, so a refused
 * write keeps the change with Retry. Feedback text saves on blur; Add and Remove save at once.
 */
export function WrongMoveFeedback({
  repertoireId,
  positionKey,
  fen,
  decision,
  canEditDecision,
  busy,
  onFeedbackChange,
  onCommitFeedback
}: {
  repertoireId: string;
  positionKey: string | null;
  /** The selected position (the player is to move here). */
  fen: string;
  decision: DecisionPracticeFields | null;
  canEditDecision: boolean;
  busy: boolean;
  onFeedbackChange: (uci: string, text: string) => void;
  /** Saves the feedback draft for `uci` (or drops it when it matches the stored text). */
  onCommitFeedback: (uci: string) => void;
}) {
  const textId = useId();
  // Subscribed here, not in the page: typing re-renders only this section.
  const drafts = useRepertoireWorkspaceStore(
    useShallow((state) =>
      Object.values(state.decisionDrafts).filter(
        (draft) =>
          draft.repertoireId === repertoireId &&
          draft.positionKey === positionKey &&
          draft.field === "feedback"
      )
    )
  );
  const feedbackDrafts = new Map<string, DecisionTextDraft>(
    drafts.map((draft) => [draft.uci!, draft])
  );
  const rows = feedbackRows(fen, decision?.wrongMoveFeedback, feedbackDrafts);
  const rowKeys = rows.map((row) => row.uci).join(",");
  const accepted = decision?.acceptedUcis.join(",") ?? "";
  const options = useMemo(
    () =>
      wrongMoveOptions(
        fen,
        new Set([...accepted.split(","), ...rowKeys.split(",")].filter(Boolean))
      ),
    [fen, accepted, rowKeys]
  );
  const disabled = !canEditDecision || busy || !positionKey;

  return (
    <section className="grid gap-3" aria-label="Wrong-move feedback">
      <SectionHeader
        as="h3"
        title="Wrong-move feedback"
        description={
          canEditDecision
            ? `Shown in practice after one of these moves. ${DECISION_SCOPE_TEXT}`
            : UNAVAILABLE_TEXT
        }
      />
      {rows.length ? (
        <ul className="grid gap-2">
          {rows.map((row) => (
            <li key={row.uci} className="flex items-end gap-1.5">
              <Field
                className="flex-1"
                label={`Feedback for ${row.san}`}
                htmlFor={`${textId}-${row.uci}`}
                hint={draftStatus(
                  row.draft,
                  row.text.length >= MAX_DECISION_TEXT_LENGTH
                    ? `Limit reached: up to ${MAX_DECISION_TEXT_LENGTH.toLocaleString()} characters`
                    : undefined
                )}
              >
                <Input
                  id={`${textId}-${row.uci}`}
                  disabled={disabled}
                  maxLength={MAX_DECISION_TEXT_LENGTH}
                  placeholder="Removed when saved empty"
                  aria-invalid={row.draft?.status === "error" || undefined}
                  value={row.text}
                  onChange={(event) => onFeedbackChange(row.uci, event.target.value)}
                  onBlur={() => onCommitFeedback(row.uci)}
                />
              </Field>
              <IconButton
                label={`Remove the feedback for ${row.san}`}
                icon={<Trash2 />}
                variant="ghost-destructive"
                size="icon-sm"
                disabled={disabled}
                onClick={() => {
                  onFeedbackChange(row.uci, "");
                  onCommitFeedback(row.uci);
                }}
              />
            </li>
          ))}
        </ul>
      ) : null}
      <AddWrongMoveFeedback
        options={options}
        disabled={disabled}
        onAdd={(uci, text) => {
          onFeedbackChange(uci, text);
          onCommitFeedback(uci);
        }}
      />
    </section>
  );
}

const UNAVAILABLE_TEXT = "Available where you are to move and have accepted at least one move.";

/** A draft's save state for a field's hint (`fallback` while it is saved or unchanged). */
function draftStatus(draft: DecisionTextDraft | undefined, fallback?: string): string | undefined {
  return draft?.status === "error"
    ? "Not saved — see the notice above"
    : draft?.status === "saving"
      ? "Saving…"
      : fallback;
}

type FeedbackRow = { uci: string; san: string; text: string; draft: DecisionTextDraft | undefined };

/** Stored feedback and feedback typed since (a removal shows until it is saved). */
function feedbackRows(
  fen: string,
  stored: DecisionPracticeFields["wrongMoveFeedback"] | undefined,
  drafts: ReadonlyMap<string, DecisionTextDraft>
): FeedbackRow[] {
  return [...new Set([...Object.keys(stored ?? {}), ...drafts.keys()])].map((uci) => ({
    uci,
    san: playUci(fen, uci)?.san ?? uci,
    text: drafts.get(uci)?.text ?? stored?.[uci] ?? "",
    draft: drafts.get(uci)
  }));
}

/** A new wrong move and its feedback: added (and saved) at once. */
function AddWrongMoveFeedback({
  options,
  disabled,
  onAdd
}: {
  /** The moves outside the repertoire that have no feedback yet. */
  options: readonly { uci: string; san: string }[];
  disabled: boolean;
  onAdd: (uci: string, text: string) => void;
}) {
  const moveId = useId();
  const textId = useId();
  const [newMove, setNewMove] = useState("");
  const [newText, setNewText] = useState("");
  // Only a move offered here now (not accepted since, nor already given feedback) can be added.
  const chosen = options.some((option) => option.uci === newMove) ? newMove : "";

  const add = () => {
    if (!chosen || !newText.trim()) return;
    onAdd(chosen, newText);
    setNewMove("");
    setNewText("");
  };

  return (
    <div className="grid gap-2">
      <Field label="Wrong move" htmlFor={moveId}>
        <Select
          id={moveId}
          disabled={disabled || !options.length}
          value={chosen}
          onChange={(event) => setNewMove(event.target.value)}
        >
          <option value="">Choose a move outside the repertoire…</option>
          {options.map((option) => (
            <option key={option.uci} value={option.uci}>
              {option.san}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Feedback" htmlFor={textId}>
        <Input
          id={textId}
          disabled={disabled}
          maxLength={MAX_DECISION_TEXT_LENGTH}
          placeholder="e.g. That drops the e-pawn"
          value={newText}
          onChange={(event) => setNewText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") add();
          }}
        />
      </Field>
      <Button
        type="button"
        variant="outline"
        size="xs"
        className="justify-self-start"
        disabled={disabled || !chosen || !newText.trim()}
        onClick={add}
      >
        Add feedback
      </Button>
    </div>
  );
}
