import { useEffect, useId, useRef, useState } from "react";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { SectionHeader } from "@/components/ui/page";

/** The longest comment a chapter save keeps (the main process's chapter validation limit). */
const MAX_COMMENT_LENGTH = 20_000;

/**
 * Notes for the selected move: its comment (part of the chapter draft, autosaved), and at a
 * position where the player has a decision, the practice prompt and hidden hint (repertoire-wide
 * decision fields, saved on blur or when the window closes). Mount with `key={nodeId}` so fields
 * reset per position.
 */
export function StudyNotesPanel({
  node,
  decisionText,
  canEditDecision,
  busy,
  onComment,
  onSaveDecisionText
}: {
  node: MoveNode;
  decisionText: { prompt: string | null; hint: string | null } | null;
  /** The player is to move here with at least one accepted move (a decision exists). */
  canEditDecision: boolean;
  busy: boolean;
  onComment: (text: string) => void;
  onSaveDecisionText: (field: "prompt" | "hint", text: string | null) => Promise<unknown> | void;
}) {
  const commentId = useId();
  const promptId = useId();
  const hintId = useId();
  const [prompt, setPrompt] = useState(decisionText?.prompt ?? "");
  const [hint, setHint] = useState(decisionText?.hint ?? "");
  const comment = node.comment ?? "";

  const commit = (field: "prompt" | "hint", value: string) => {
    const next = value.trim() ? value.trim() : null;
    if (next === (decisionText?.[field] ?? null)) return;
    return onSaveDecisionText(field, next);
  };

  // Closing the window doesn't blur the focused field: save what it holds then.
  const pending = useRef({ commit, prompt, hint });
  useEffect(() => {
    pending.current = { commit, prompt, hint };
  });
  useEffect(
    () =>
      window.chaturanga?.games.onFlushRequest?.(async () => {
        const { commit: save, prompt: promptText, hint: hintText } = pending.current;
        await Promise.all([save("prompt", promptText), save("hint", hintText)]);
        return true;
      }),
    []
  );

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
        <Field label="Prompt" hint="Shown during practice" htmlFor={promptId}>
          <Input
            id={promptId}
            disabled={!canEditDecision || busy}
            placeholder="e.g. Develop with tempo"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onBlur={() => commit("prompt", prompt)}
          />
        </Field>
        <Field label="Hint" hint="Hidden until asked for" htmlFor={hintId}>
          <Input
            id={hintId}
            disabled={!canEditDecision || busy}
            placeholder="e.g. The knight belongs on f3"
            value={hint}
            onChange={(event) => setHint(event.target.value)}
            onBlur={() => commit("hint", hint)}
          />
        </Field>
      </section>
    </div>
  );
}
