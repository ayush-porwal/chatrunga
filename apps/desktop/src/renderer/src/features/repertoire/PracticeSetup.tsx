import { useId, useState } from "react";
import { GraduationCap, Sparkles } from "lucide-react";
import type {
  PracticeMode,
  RepertoireDetail,
  StartPracticeInput
} from "@chaturanga/shared/types/repertoire";
import { ChipButton } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { SectionHeader } from "@/components/ui/page";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cardPadded } from "@/lib/ui";
import { sortedChapters } from "./repertoire-chapters";

export const DEFAULT_CARD_LIMIT = 20;
export const DEFAULT_NEW_CARD_LIMIT = 5;

const modeOptions = [
  { value: "review-due" as const, label: "Review due" },
  { value: "learn-new" as const, label: "Learn new" }
];

/** The setup's starting values: the saved draft, a preset chapter selection, or the defaults. */
export function initialPracticeInput(
  detail: RepertoireDetail,
  preset: { chapterIds?: string[]; mode?: PracticeMode } | null
): StartPracticeInput {
  const saved = detail.workspace?.practiceDraft;
  const base: StartPracticeInput =
    saved && saved.repertoireId === detail.id
      ? saved
      : {
          repertoireId: detail.id,
          mode: "review-due",
          cardLimit: DEFAULT_CARD_LIMIT,
          newCardLimit: DEFAULT_NEW_CARD_LIMIT
        };
  return {
    ...base,
    ...(preset?.chapterIds ? { chapterIds: preset.chapterIds } : {}),
    ...(preset?.mode ? { mode: preset.mode } : {})
  };
}

/** A positive whole number from a field, or undefined when it is empty or invalid. */
function positiveInt(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Practice setup (§5.3): mode, chapters (none selected = every enabled opening chapter), maximum
 * depth and card limits. "Nothing due" offers Learn new instead.
 */
export function PracticeSetup({
  detail,
  initial,
  starting,
  error,
  nothingDue,
  onStart
}: {
  detail: RepertoireDetail;
  initial: StartPracticeInput;
  starting: boolean;
  error: string | null;
  /** The last start found no cards for its scope and mode. */
  nothingDue: PracticeMode | null;
  onStart: (input: StartPracticeInput) => void;
}) {
  const ids = { depth: useId(), cards: useId(), fresh: useId() };
  const [mode, setMode] = useState<PracticeMode>(initial.mode);
  const [chapterIds, setChapterIds] = useState<string[]>(initial.chapterIds ?? []);
  const [depth, setDepth] = useState(initial.maxDepthPlies ? String(initial.maxDepthPlies) : "");
  const [cards, setCards] = useState(String(initial.cardLimit ?? DEFAULT_CARD_LIMIT));
  const [fresh, setFresh] = useState(String(initial.newCardLimit ?? DEFAULT_NEW_CARD_LIMIT));
  const trainable = sortedChapters(detail.chapters).filter(
    (chapter) => chapter.kind === "opening" && chapter.enabled
  );

  const input = (override?: PracticeMode): StartPracticeInput => ({
    repertoireId: detail.id,
    mode: override ?? mode,
    ...(chapterIds.length ? { chapterIds } : {}),
    ...(positiveInt(depth) ? { maxDepthPlies: positiveInt(depth) } : {}),
    cardLimit: positiveInt(cards) ?? DEFAULT_CARD_LIMIT,
    newCardLimit: positiveInt(fresh) ?? 0
  });

  const toggle = (id: string) =>
    setChapterIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );

  return (
    <div className="scroll-area h-full min-h-0 overflow-y-auto">
      <div className="mx-auto grid w-full max-w-2xl content-start gap-5 px-(--page-gutter) py-(--page-gutter-y)">
        <h1 className="sr-only">Practice {detail.name}</h1>
        {nothingDue === "review-due" ? (
          <EmptyState
            className={cardPadded}
            icon={<GraduationCap />}
            title="No reviews due in this scope"
            description="Everything here is scheduled for later. You can learn decisions you haven't practised yet."
            action={
              <Button
                type="button"
                variant="primary"
                disabled={starting}
                onClick={() => onStart(input("learn-new"))}
              >
                <Sparkles />
                Learn new
              </Button>
            }
          />
        ) : nothingDue === "learn-new" ? (
          <Notice tone="info" title="Nothing new to learn here">
            Every decision in this scope has been practised. Add accepted moves while studying to
            create new ones.
          </Notice>
        ) : null}
        <section className={`${cardPadded} grid gap-4`} aria-label="Practice setup">
          <SectionHeader
            title="Practice"
            description="One decision at a time: play any move you accepted for the position."
          />
          <SegmentedControl
            ariaLabel="Practice mode"
            value={mode}
            onChange={setMode}
            options={modeOptions}
          />
          <div className="grid gap-2">
            <p className="text-xs font-medium text-fg-secondary">Chapters</p>
            {trainable.length ? (
              <div className="flex flex-wrap gap-1.5">
                {trainable.map((chapter) => (
                  <ChipButton
                    key={chapter.id}
                    selected={chapterIds.includes(chapter.id)}
                    onClick={() => toggle(chapter.id)}
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
            <p className="text-2xs text-fg-subtle">
              {chapterIds.length
                ? `${chapterIds.length} selected`
                : "None selected: every enabled opening chapter."}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Max depth" hint="plies from the chapter start" htmlFor={ids.depth}>
              <Input
                id={ids.depth}
                inputMode="numeric"
                placeholder="Any"
                value={depth}
                onChange={(event) => setDepth(event.target.value)}
              />
            </Field>
            <Field label="Cards" htmlFor={ids.cards}>
              <Input
                id={ids.cards}
                inputMode="numeric"
                value={cards}
                onChange={(event) => setCards(event.target.value)}
              />
            </Field>
            <Field label="New cards" hint="after due ones" htmlFor={ids.fresh}>
              <Input
                id={ids.fresh}
                inputMode="numeric"
                value={fresh}
                onChange={(event) => setFresh(event.target.value)}
              />
            </Field>
          </div>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Button
            type="button"
            variant="primary"
            className="justify-self-start"
            disabled={starting || !trainable.length}
            onClick={() => onStart(input())}
          >
            <GraduationCap />
            {starting ? "Starting…" : mode === "review-due" ? "Start review" : "Start learning"}
          </Button>
        </section>
      </div>
    </div>
  );
}
