import { useId } from "react";
import { CHAPTER_KINDS } from "@chaturanga/shared/types/repertoire";
import { isOneOf } from "@chaturanga/shared/types/guards";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { fieldHint, fieldLabel } from "@/lib/ui";
import type { ScopeChoice } from "./add-from-game";
import { COLOR_LABELS } from "./repertoire-chapters";
import type { AddDestinationForm, AddScopeForm } from "./useAddToRepertoireForm";

const destinationOptions = [
  { value: "new-chapter" as const, label: "New chapter" },
  { value: "existing-chapter" as const, label: "Existing chapter" }
];

const branchRootOptions = [
  { value: "original" as const, label: "Keep the game's moves before it" },
  { value: "standalone" as const, label: "Start the chapter here" }
];

const scopeHints: Record<ScopeChoice, string> = {
  path: "The moves from the start to the selected move, without side variations.",
  subtree: "Every move after the selected position, with its variations.",
  "whole-game": "Every move and variation. A whole game is best kept as reference material."
};

/** The repertoire, then the chapter in it: a new one (title and kind) or an existing one. */
export function AddDestinationFields({
  target,
  onPickRepertoire
}: {
  target: AddDestinationForm;
  onPickRepertoire: (repertoireId: string | null) => void;
}) {
  const ids = { repertoire: useId(), chapter: useId(), title: useId(), kind: useId() };
  const { repertoires, repertoireId, chapters, title } = target;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Repertoire" htmlFor={ids.repertoire}>
          <Select
            id={ids.repertoire}
            value={repertoireId ?? ""}
            disabled={!repertoires.length}
            onChange={(event) => onPickRepertoire(event.target.value || null)}
          >
            {repertoireId ? null : <option value="">Choose a repertoire…</option>}
            {repertoires.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({COLOR_LABELS[item.color]})
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-1.5">
          <p className={fieldLabel}>Into</p>
          <SegmentedControl
            ariaLabel="Destination chapter"
            fullWidth
            value={target.kind}
            onChange={target.setKind}
            options={destinationOptions.map((option) => ({
              ...option,
              disabled: option.value === "existing-chapter" && !chapters.length
            }))}
          />
        </div>
      </div>

      {target.kind === "new-chapter" ? (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <Field label="Chapter title" htmlFor={ids.title}>
            <Input
              id={ids.title}
              value={title}
              aria-invalid={!title.trim() || undefined}
              onChange={(event) => target.setTitle(event.target.value)}
            />
          </Field>
          <Field label="Kind" htmlFor={ids.kind}>
            <Select
              id={ids.kind}
              value={target.chapterKind}
              onChange={(event) => {
                const kind = event.target.value;
                if (isOneOf(CHAPTER_KINDS, kind)) target.setChapterKind(kind);
              }}
            >
              <option value="opening">Opening</option>
              <option value="reference">Reference</option>
            </Select>
          </Field>
        </div>
      ) : (
        <Field label="Chapter" htmlFor={ids.chapter}>
          <Select
            id={ids.chapter}
            value={target.chapterId ?? ""}
            onChange={(event) => target.setChapterId(event.target.value)}
          >
            {chapters.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapter.title}
                {chapter.kind === "reference" ? " (reference)" : ""}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </>
  );
}

/** What of the game to add, and where a branch's chapter starts. */
export function AddScopeFields({ scope }: { scope: AddScopeForm }) {
  return (
    <div className="grid gap-1.5">
      <p className={fieldLabel}>What to add</p>
      <SegmentedControl
        ariaLabel="What to add"
        fullWidth
        value={scope.choice}
        onChange={scope.setChoice}
        options={scope.options}
      />
      {scope.choice === "subtree" ? (
        <SegmentedControl
          ariaLabel="Where the chapter starts"
          size="sm"
          fullWidth
          value={scope.branchRoot}
          onChange={scope.setBranchRoot}
          options={branchRootOptions}
        />
      ) : null}
      <p className={fieldHint}>{scopeHints[scope.choice]}</p>
    </div>
  );
}
