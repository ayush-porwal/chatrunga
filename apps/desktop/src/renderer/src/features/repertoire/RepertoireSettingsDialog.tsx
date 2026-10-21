import { useId, useState } from "react";
import type { RepertoireDetail } from "@chaturanga/shared/types/repertoire";
import {
  defaultSettings,
  PRACTICE_AUTO_ADVANCE_MS,
  type PracticeAutoAdvanceMs
} from "@chaturanga/shared/types/settings";
import { isOneOf } from "@chaturanga/shared/types/guards";
import { ChipButton } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { fieldHint } from "@/lib/ui";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { useSettingsQuery } from "../../queries/api";
import { useSaveRepertoireWorkspaceMutation } from "../../queries/repertoire";
import { useSetSetting } from "../settings/use-set-setting";
import {
  MAX_CARD_LIMIT,
  MAX_DEPTH_PLIES,
  practiceSettings,
  practiceSettingsForm,
  practiceSettingsFromForm,
  type PracticeSettingsForm
} from "./practice-setup";
import { sortedChapters } from "./repertoire-chapters";

const kindOptions = [
  { value: "positions" as const, label: "Positions" },
  { value: "lines" as const, label: "Lines" }
];

/** "Next card" choices: wait for Next, or move on by itself after a correct answer. */
const ADVANCE_LABELS: Record<PracticeAutoAdvanceMs, string> = {
  0: "When I press Next",
  600: "After 0.6 s",
  1500: "After 1.5 s",
  3000: "After 3 s"
};

/**
 * The repertoire's settings (the cog in Study and Practice): what Practice starts. Positions
 * reviews the due ones first, then new ones, from the chosen chapters (none: every enabled opening
 * chapter) up to a depth, with card limits; Lines rehearses a chapter's lines instead.
 * "Next card" is the app-wide auto-advance. Saved together with Save; a running session keeps
 * its own scope.
 */
export function RepertoireSettingsDialog({
  detail,
  onClose
}: {
  detail: RepertoireDetail;
  onClose: () => void;
}) {
  const ids = { depth: useId(), cards: useId(), fresh: useId(), advance: useId() };
  const settings = useSettingsQuery();
  const setSetting = useSetSetting();
  const save = useSaveRepertoireWorkspaceMutation();
  const [form, setForm] = useState<PracticeSettingsForm>(() =>
    practiceSettingsForm(practiceSettings(detail))
  );
  const [advance, setAdvance] = useState<PracticeAutoAdvanceMs | null>(null);
  const advanceMs =
    advance ?? settings.data?.practiceAutoAdvanceMs ?? defaultSettings.practiceAutoAdvanceMs;
  const trainable = sortedChapters(detail.chapters).filter(
    (chapter) => chapter.kind === "opening" && chapter.enabled
  );
  const update = (patch: Partial<PracticeSettingsForm>) =>
    setForm((current) => ({ ...current, ...patch }));
  const toggleChapter = (id: string) =>
    update({
      chapterIds: form.chapterIds.includes(id)
        ? form.chapterIds.filter((item) => item !== id)
        : [...form.chapterIds, id]
    });

  function submit() {
    if (advance !== null) setSetting("practiceAutoAdvanceMs", advance);
    save.mutate(
      {
        repertoireId: detail.id,
        workspace: {
          lastChapterId: detail.workspace?.lastChapterId ?? null,
          lastNodeId: detail.workspace?.lastNodeId ?? null,
          orientation: detail.workspace?.orientation ?? detail.color,
          practiceDraft: practiceSettingsFromForm({ repertoireId: detail.id, ...form })
        },
        practiceSetup: true
      },
      { onSuccess: onClose }
    );
  }

  return (
    <Dialog
      title="Repertoire settings"
      description={detail.name}
      onClose={onClose}
      bodyClassName="grid gap-5"
      footer={
        <>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={save.isPending}
            onClick={submit}
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="grid gap-1.5">
        <p className="text-xs font-medium text-fg-secondary">Practice</p>
        <SegmentedControl
          ariaLabel="Practice"
          value={form.lines ? "lines" : "positions"}
          onChange={(value) => update({ lines: value === "lines" })}
          options={kindOptions}
        />
        <p className={fieldHint}>
          {form.lines
            ? "Play your moves along a chapter's lines (the one open in Study, else the one last studied); the replies come from it. Nothing is scheduled."
            : "One position at a time: the due ones first, then new ones."}
        </p>
      </div>

      {form.lines ? null : (
        <div className="grid gap-2">
          <p className="text-xs font-medium text-fg-secondary">Chapters</p>
          {trainable.length ? (
            <div className="flex flex-wrap gap-1.5">
              {trainable.map((chapter) => (
                <ChipButton
                  key={chapter.id}
                  selected={form.chapterIds.includes(chapter.id)}
                  onClick={() => toggleChapter(chapter.id)}
                >
                  {chapter.title}
                  {chapter.dueCount ? (
                    <span className="text-fg-subtle">· {chapter.dueCount}</span>
                  ) : null}
                </ChipButton>
              ))}
            </div>
          ) : (
            <p className="text-xs text-fg-muted">No enabled opening chapters to practise.</p>
          )}
          <p className={fieldHint}>
            {form.chapterIds.length
              ? `${form.chapterIds.length} selected`
              : "None selected: every enabled opening chapter."}
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Max depth" hint="plies from the chapter start" htmlFor={ids.depth}>
          <Input
            id={ids.depth}
            type="number"
            min={1}
            max={MAX_DEPTH_PLIES}
            inputMode="numeric"
            placeholder="Any"
            value={form.depth}
            onChange={(event) => update({ depth: event.target.value })}
          />
        </Field>
        {form.lines ? null : (
          <>
            <Field label="Cards" hint="due ones" htmlFor={ids.cards}>
              <Input
                id={ids.cards}
                type="number"
                min={1}
                max={MAX_CARD_LIMIT}
                inputMode="numeric"
                value={form.cards}
                onChange={(event) => update({ cards: event.target.value })}
              />
            </Field>
            <Field label="New cards" hint="after due ones" htmlFor={ids.fresh}>
              <Input
                id={ids.fresh}
                type="number"
                min={0}
                max={MAX_CARD_LIMIT}
                inputMode="numeric"
                value={form.fresh}
                onChange={(event) => update({ fresh: event.target.value })}
              />
            </Field>
          </>
        )}
      </div>

      {form.lines ? null : (
        <Field
          label="Next card"
          hint="after a correct answer; one with notes waits for Next"
          htmlFor={ids.advance}
        >
          <Select
            id={ids.advance}
            className="sm:max-w-56"
            value={String(advanceMs)}
            onChange={(event) => {
              const delay = Number(event.target.value);
              if (isOneOf(PRACTICE_AUTO_ADVANCE_MS, delay)) setAdvance(delay);
            }}
          >
            {PRACTICE_AUTO_ADVANCE_MS.map((delay) => (
              <option key={delay} value={delay}>
                {ADVANCE_LABELS[delay]}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {save.error ? (
        <Notice tone="danger">
          {ipcErrorMessage(save.error) || "Couldn't save the settings."}
        </Notice>
      ) : null}
    </Dialog>
  );
}
