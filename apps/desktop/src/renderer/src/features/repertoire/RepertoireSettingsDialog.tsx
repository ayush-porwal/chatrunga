import { useId, useState } from "react";
import type { RepertoireDetail } from "@chaturanga/shared/types/repertoire";
import {
  defaultSettings,
  PRACTICE_AUTO_ADVANCE_MS,
  type AppSettings,
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
import { Switch } from "@/components/ui/switch";
import { fieldHint } from "@/lib/ui";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { useSettingsQuery } from "../../queries/api";
import { useSaveRepertoireWorkspaceMutation } from "../../queries/repertoire";
import { useSettingsWriter } from "../settings/use-set-setting";
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
 * reviews the due ones first, then new ones within the daily limit, from the chosen chapters
 * (none: every enabled opening chapter) up to a depth, with a card limit; Lines rehearses a
 * chapter's lines instead.
 * "Next card" is the app-wide auto-advance. Saved together with Save (the repertoire's settings
 * first; "Next card" only once they are), closing once both are; a failure stays in the dialog.
 * A running session keeps its own scope. From Study (`study`) it also has the Board section:
 * the app-wide "Repertoire arrows" (saved with "Next card").
 */
export function RepertoireSettingsDialog({
  detail,
  study = false,
  onClose,
  onSaved
}: {
  detail: RepertoireDetail;
  /** Opened from Study: offers the Study board's settings too. */
  study?: boolean;
  onClose: () => void;
  /** Both writes succeeded: the repertoire as it now is (before the dialog closes). */
  onSaved?: (saved: RepertoireDetail) => void;
}) {
  const ids = { depth: useId(), cards: useId(), advance: useId() };
  const settings = useSettingsQuery();
  const { saveMany } = useSettingsWriter();
  const save = useSaveRepertoireWorkspaceMutation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<PracticeSettingsForm>(() =>
    practiceSettingsForm(practiceSettings(detail))
  );
  const [advance, setAdvance] = useState<PracticeAutoAdvanceMs | null>(null);
  const advanceMs =
    advance ?? settings.data?.practiceAutoAdvanceMs ?? defaultSettings.practiceAutoAdvanceMs;
  const [arrows, setArrows] = useState<boolean | null>(null);
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

  async function submit() {
    setSaving(true);
    setError(null);
    const workspace = {
      lastChapterId: detail.workspace?.lastChapterId ?? null,
      lastNodeId: detail.workspace?.lastNodeId ?? null,
      orientation: detail.workspace?.orientation ?? detail.color,
      practiceDraft: practiceSettingsFromForm({ repertoireId: detail.id, ...form })
    };
    try {
      await save.mutateAsync({ repertoireId: detail.id, workspace, practiceSetup: true });
    } catch (cause) {
      setError(ipcErrorMessage(cause) || "Couldn't save the settings.");
      setSaving(false);
      return;
    }
    const patch = appSettingsPatch(advance, arrows);
    if (patch) {
      try {
        await saveMany(patch);
      } catch (cause) {
        setError(ipcErrorMessage(cause) || "Couldn't save the settings.");
        setSaving(false);
        return;
      }
    }
    onSaved?.({ ...detail, workspace });
    onClose();
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
            disabled={saving}
            onClick={() => void submit()}
          >
            {saving ? "Saving…" : "Save"}
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

      <div className="grid gap-3 sm:grid-cols-2">
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
          // New positions come within the daily limit (Practice settings), not a count here.
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

      {study ? <StudyBoardSettings arrows={arrows} onArrowsChange={setArrows} /> : null}

      {error ? <Notice tone="danger">{error}</Notice> : null}
    </Dialog>
  );
}

/** The app-wide settings the dialog changed ("Next card", "Repertoire arrows"); null: none. */
function appSettingsPatch(
  advance: PracticeAutoAdvanceMs | null,
  arrows: boolean | null
): Partial<AppSettings> | null {
  const patch: Partial<AppSettings> = {};
  if (advance !== null) patch.practiceAutoAdvanceMs = advance;
  if (arrows !== null) patch.studyRepertoireArrows = arrows;
  return Object.keys(patch).length ? patch : null;
}

/** Study's board settings: the repertoire's arrows (`arrows` as changed here; null: as saved). */
function StudyBoardSettings({
  arrows,
  onArrowsChange
}: {
  arrows: boolean | null;
  onArrowsChange: (on: boolean) => void;
}) {
  const settings = useSettingsQuery();
  const on =
    arrows ?? settings.data?.studyRepertoireArrows ?? defaultSettings.studyRepertoireArrows;
  return (
    <div className="grid gap-1.5">
      <p className="text-xs font-medium text-fg-secondary">Board</p>
      <label className="flex items-center justify-between gap-3 text-sm text-fg">
        Repertoire arrows
        <Switch checked={on} onCheckedChange={onArrowsChange} aria-label="Repertoire arrows" />
      </label>
      <p className={fieldHint}>Off: quiz yourself while studying.</p>
    </div>
  );
}
