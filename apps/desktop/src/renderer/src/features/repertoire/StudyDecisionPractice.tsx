import { useId, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import type { RepertoireDecision } from "@chaturanga/shared/types/repertoire";
import { Button } from "@/components/ui/button";
import { Field, SettingRow } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input, Select } from "@/components/ui/input";
import { SectionHeader } from "@/components/ui/page";
import { Switch } from "@/components/ui/switch";
import { playUci, useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import {
  DECISION_SCOPE_TEXT,
  MAX_DECISION_TEXT_LENGTH,
  wrongMoveOptions,
  type DecisionTextDraft
} from "./repertoire-model";

type DecisionPracticeFields = Pick<
  RepertoireDecision,
  "acceptedUcis" | "wrongMoveFeedback" | "paused"
>;

/**
 * Wrong-move feedback and pausing for the decision at the selected position: what practice says
 * after a specific move outside the repertoire, and whether the decision is practised at all.
 * Like the prompt and hint, both are stored once per position (every occurrence and transposition
 * shares them) and change through decision drafts, so a refused write keeps the change with Retry.
 * Feedback text saves on blur; Add and Remove save at once, as does the pause switch.
 */
export function StudyDecisionPractice({
  repertoireId,
  positionKey,
  fen,
  decision,
  canEditDecision,
  busy,
  onFeedbackChange,
  onCommitFeedback,
  onSetPaused
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
  onSetPaused: (paused: boolean) => void;
}) {
  const pauseId = useId();
  const moveId = useId();
  const textId = useId();
  const [newMove, setNewMove] = useState("");
  const [newText, setNewText] = useState("");
  // Subscribed here, not in the page: typing re-renders only this section.
  const drafts = useRepertoireWorkspaceStore(
    useShallow((state) =>
      Object.values(state.decisionDrafts).filter(
        (draft) =>
          draft.repertoireId === repertoireId &&
          draft.positionKey === positionKey &&
          (draft.field === "feedback" || draft.field === "paused")
      )
    )
  );
  const feedbackDrafts = new Map<string, DecisionTextDraft>(
    drafts.filter((draft) => draft.field === "feedback").map((draft) => [draft.uci!, draft])
  );
  const pauseDraft = drafts.find((draft) => draft.field === "paused");
  const stored = decision?.wrongMoveFeedback;

  // Stored feedback and feedback typed since (a removal shows until it is saved).
  const rows = [...new Set([...Object.keys(stored ?? {}), ...feedbackDrafts.keys()])].map(
    (uci) => ({
      uci,
      san: playUci(fen, uci)?.san ?? uci,
      text: feedbackDrafts.get(uci)?.text ?? stored?.[uci] ?? "",
      draft: feedbackDrafts.get(uci)
    })
  );
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
  const paused = pauseDraft?.paused ?? decision?.paused ?? false;
  const disabled = !canEditDecision || busy || !positionKey;

  const statusOf = (draft: DecisionTextDraft | undefined, fallback?: string) =>
    draft?.status === "error"
      ? "Not saved — see the notice above"
      : draft?.status === "saving"
        ? "Saving…"
        : fallback;

  const add = () => {
    if (!newMove || !newText.trim()) return;
    onFeedbackChange(newMove, newText);
    onCommitFeedback(newMove);
    setNewMove("");
    setNewText("");
  };

  return (
    <>
      <section className="grid gap-3" aria-label="Wrong-move feedback">
        <SectionHeader
          as="h3"
          title="Wrong-move feedback"
          description={
            canEditDecision
              ? `Shown in practice after one of these moves. ${DECISION_SCOPE_TEXT}`
              : "Available where you are to move and have accepted at least one move."
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
                  hint={statusOf(
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
        <div className="grid gap-2">
          <Field label="Wrong move" htmlFor={moveId}>
            <Select
              id={moveId}
              disabled={disabled || !options.length}
              value={newMove}
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
            disabled={disabled || !newMove || !newText.trim()}
            onClick={add}
          >
            Add feedback
          </Button>
        </div>
      </section>

      <section className="grid gap-1" aria-label="Pause practice">
        <SectionHeader
          as="h3"
          title="Pause practice"
          description={
            canEditDecision
              ? DECISION_SCOPE_TEXT
              : "Available where you are to move and have accepted at least one move."
          }
        />
        <SettingRow
          htmlFor={pauseId}
          label={paused ? "Paused" : "Practised"}
          description={
            statusOf(pauseDraft) ??
            (paused
              ? "Left out of practice and due counts. Its progress is kept for when you resume."
              : "Pausing leaves it out of practice and due counts and keeps its progress.")
          }
          control={
            <Switch
              id={pauseId}
              checked={paused}
              disabled={disabled}
              aria-label={paused ? "Resume this decision" : "Pause this decision"}
              onCheckedChange={onSetPaused}
            />
          }
        />
      </section>
    </>
  );
}
