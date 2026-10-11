import { useId, useMemo, useState } from "react";
import { GraduationCap, Route } from "lucide-react";
import {
  DEFAULT_REHEARSAL_DEPTH_PLIES,
  canRehearseFrom,
  lineEnds,
  rehearsalContext
} from "@chaturanga/shared/chess/repertoire-rehearsal";
import {
  REPERTOIRE_ROOT_NODE_ID,
  type PracticeMode,
  type RepertoireChapterSummary,
  type RepertoireDetail,
  type StartPracticeInput
} from "@chaturanga/shared/types/repertoire";
import {
  defaultSettings,
  PRACTICE_AUTO_ADVANCE_MS,
  type PracticeAutoAdvanceMs
} from "@chaturanga/shared/types/settings";
import { ChipButton } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { SectionHeader } from "@/components/ui/page";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cardPadded } from "@/lib/ui";
import { useSettingsQuery } from "../../queries/api";
import { useRepertoireChapterQuery, useRepertoirePausedKeysQuery } from "../../queries/repertoire";
import { useSetSetting } from "../settings/use-set-setting";
import { sortedChapters } from "./repertoire-chapters";
import { pathLabel } from "./repertoire-model";
import { startUnavailableReason } from "./training-explanations";
import { PracticeEmptyState } from "./PracticeEmptyState";
import {
  MAX_CARD_LIMIT,
  MAX_DEPTH_PLIES,
  MAX_REHEARSE_STARTS,
  boundedInt,
  explainedChapterIds,
  practiceFormFields,
  practiceInputFromForm,
  rehearseStarts,
  type RehearseStart
} from "./practice-setup";
import { isOneOf } from "@chaturanga/shared/types/guards";

const modeOptions = [
  { value: "review-due" as const, label: "Review due" },
  { value: "learn-new" as const, label: "Learn new" },
  { value: "rehearse-lines" as const, label: "Rehearse lines" }
];

/** "Next card" choices: wait for Next, or move on by itself after a correct answer. */
const ADVANCE_LABELS: Record<PracticeAutoAdvanceMs, string> = {
  0: "When I press Next",
  600: "After 0.6 s",
  1500: "After 1.5 s",
  3000: "After 3 s"
};

const START_LABELS: Record<PracticeMode, string> = {
  "review-due": "Start review",
  "learn-new": "Start learning",
  "rehearse-lines": "Start rehearsal"
};

/**
 * Practice setup (§5.3): mode, chapters (none selected = every enabled opening chapter), maximum
 * depth and card limits. A start with nothing to ask says why above the form: the chapter in scope
 * and its cause with a way back to Study, or what the mode found ("Nothing due" offers Learn new).
 * A repertoire with no decision at all is explained before any start, and Start is disabled with
 * the reason. Rehearse lines picks one chapter and optionally a branch to start from; card limits
 * don't apply to it. "Next card" is the saved auto-advance preference (a setting, not part of the
 * draft).
 */
export function PracticeSetup({
  detail,
  initial,
  starting,
  error,
  empty,
  onStart,
  onStudy
}: {
  detail: RepertoireDetail;
  initial: StartPracticeInput;
  starting: boolean;
  error: string | null;
  /** The last start, which found no cards for its scope and mode (null: none did). */
  empty: StartPracticeInput | null;
  onStart: (input: StartPracticeInput) => void;
  /** Study at a chapter and move (the way to fix a chapter with nothing to practise). */
  onStudy: (target: { chapterId: string; nodeId: string | null }) => void;
}) {
  const ids = { depth: useId(), cards: useId(), fresh: useId() };
  const settings = useSettingsQuery();
  const setSetting = useSetSetting();
  const advanceMs = settings.data?.practiceAutoAdvanceMs ?? defaultSettings.practiceAutoAdvanceMs;
  const trainable = sortedChapters(detail.chapters).filter(
    (chapter) => chapter.kind === "opening" && chapter.enabled
  );
  const fields = practiceFormFields(initial, trainable);
  const [mode, setMode] = useState<PracticeMode>(fields.mode);
  const [chapterIds, setChapterIds] = useState(fields.chapterIds);
  const [depth, setDepth] = useState(fields.depth);
  const [cards, setCards] = useState(fields.cards);
  const [fresh, setFresh] = useState(fields.fresh);
  const rehearsing = mode === "rehearse-lines";
  const rehearsal = useRehearsalChoice(detail, {
    opening: fields,
    preselected: initial.rehearse,
    active: rehearsing,
    depth
  });

  const input = (override?: PracticeMode): StartPracticeInput =>
    practiceInputFromForm({
      repertoireId: detail.id,
      mode: override ?? mode,
      chapterIds,
      depth,
      cards,
      fresh,
      rehearseChapterId: rehearsal.chapterId,
      rehearseFromNodeId: rehearsal.fromNodeId
    });

  // A repertoire with no decision at all is explained before any start.
  const explaining = empty ?? (detail.decisionCount && trainable.length ? null : input());
  // Kept by value: `explaining` is a new object each render, and the empty state reads these.
  const explainedKey = explaining ? explainedChapterIds(detail, explaining).join("\n") : "";
  const explainedIds = useMemo(
    () => (explainedKey ? explainedKey.split("\n") : []),
    [explainedKey]
  );
  const unavailable = startUnavailableReason({
    decisionCount: detail.decisionCount,
    practicableChapters: trainable.length,
    rehearsing,
    rehearseChapterId: rehearsal.chapterId,
    rehearseChapterAsks: rehearsal.branch.asks
  });

  const toggle = (id: string) =>
    setChapterIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );

  return (
    <div className="scroll-area h-full min-h-0 overflow-y-auto">
      <div className="mx-auto grid w-full max-w-2xl content-start gap-5 px-(--page-gutter) py-(--page-gutter-y)">
        <h1 className="sr-only">Practice {detail.name}</h1>
        {explaining ? (
          <PracticeEmptyState
            detail={detail}
            mode={explaining.mode}
            chapterIds={explainedIds}
            scopeLarger={(explaining.chapterIds?.length ?? 0) > explainedIds.length}
            starting={starting}
            onLearnNew={() => onStart(input("learn-new"))}
            onStudy={onStudy}
          />
        ) : null}
        <section className={`${cardPadded} grid gap-4`} aria-label="Practice setup">
          <SectionHeader title="Practice" description={MODE_DESCRIPTIONS[mode]} />
          <SegmentedControl
            ariaLabel="Practice mode"
            value={mode}
            onChange={setMode}
            options={modeOptions}
          />
          {rehearsing ? <RehearsalFields trainable={trainable} rehearsal={rehearsal} /> : null}
          <ChapterChips
            trainable={trainable}
            selected={chapterIds}
            hidden={rehearsing}
            onToggle={toggle}
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Max depth" hint="plies from the chapter start" htmlFor={ids.depth}>
              <Input
                id={ids.depth}
                type="number"
                min={1}
                max={MAX_DEPTH_PLIES}
                inputMode="numeric"
                placeholder="Any"
                value={depth}
                onChange={(event) => setDepth(event.target.value)}
              />
            </Field>
            {rehearsing ? null : (
              <>
                <Field label="Cards" htmlFor={ids.cards}>
                  <Input
                    id={ids.cards}
                    type="number"
                    min={1}
                    max={MAX_CARD_LIMIT}
                    inputMode="numeric"
                    value={cards}
                    onChange={(event) => setCards(event.target.value)}
                  />
                </Field>
                <Field label="New cards" hint="after due ones" htmlFor={ids.fresh}>
                  <Input
                    id={ids.fresh}
                    type="number"
                    min={0}
                    max={MAX_CARD_LIMIT}
                    inputMode="numeric"
                    value={fresh}
                    onChange={(event) => setFresh(event.target.value)}
                  />
                </Field>
              </>
            )}
          </div>
          {rehearsing ? null : (
            <NextCardField
              value={advanceMs}
              onChange={(delay) => setSetting("practiceAutoAdvanceMs", delay)}
            />
          )}
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <StartPracticeButton
            mode={mode}
            starting={starting}
            unavailable={unavailable}
            onStart={() => onStart(input())}
          />
        </section>
      </div>
    </div>
  );
}

const MODE_DESCRIPTIONS: Record<PracticeMode, string> = {
  "review-due": "One decision at a time: play any move you accepted for the position.",
  "learn-new": "One decision at a time: play any move you accepted for the position.",
  "rehearse-lines":
    "Play your moves along the chapter's lines; replies are supplied from the chapter. Results stay in this session."
};

type RehearsalChoice = ReturnType<typeof useRehearsalChoice>;

/**
 * The chapter and branch a rehearsal plays, starting from `opening` (the setup's rehearsal
 * fields), with the branches it can start from while `active`. `preselected` is the rehearsal the
 * setup opened with: its branch stays offered while its chapter is chosen.
 */
function useRehearsalChoice(
  detail: RepertoireDetail,
  {
    opening,
    preselected,
    active,
    depth
  }: {
    opening: { rehearseChapterId: string; rehearseFromNodeId: string };
    preselected: StartPracticeInput["rehearse"];
    active: boolean;
    /** The depth field, as typed. */
    depth: string;
  }
) {
  const [chapterId, setChapterId] = useState(opening.rehearseChapterId);
  const [fromNodeId, setFromNodeId] = useState(opening.rehearseFromNodeId);
  const branch = useRehearseStarts(
    detail,
    active && chapterId ? chapterId : null,
    preselected?.chapterId === chapterId ? (preselected.fromNodeId ?? "") : "",
    boundedInt(depth, 1, MAX_DEPTH_PLIES) ?? DEFAULT_REHEARSAL_DEPTH_PLIES
  );
  // A branch that is no longer in the chapter starts from the chapter start (once it's loaded).
  const effectiveFrom =
    branch.loading || branch.starts.some((start) => start.nodeId === fromNodeId) ? fromNodeId : "";
  return {
    chapterId,
    fromNodeId: effectiveFrom,
    branch,
    chooseChapter: (id: string) => {
      setChapterId(id);
      setFromNodeId("");
    },
    chooseFrom: setFromNodeId
  };
}

/** Rehearse lines: the chapter, and the branch to start from (the chapter start by default). */
function RehearsalFields({
  trainable,
  rehearsal
}: {
  trainable: readonly RepertoireChapterSummary[];
  rehearsal: RehearsalChoice;
}) {
  const chapterFieldId = useId();
  const fromFieldId = useId();
  const { branch } = rehearsal;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Chapter" htmlFor={chapterFieldId}>
        <Select
          id={chapterFieldId}
          value={rehearsal.chapterId}
          disabled={!trainable.length}
          onChange={(event) => rehearsal.chooseChapter(event.target.value)}
        >
          {trainable.length ? null : <option value="">No chapters</option>}
          {trainable.map((chapter) => (
            <option key={chapter.id} value={chapter.id}>
              {chapter.title}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Start from"
        hint={
          branch.truncated
            ? `first ${MAX_REHEARSE_STARTS} positions listed`
            : branch.loading
              ? "loading the chapter…"
              : undefined
        }
        htmlFor={fromFieldId}
      >
        <Select
          id={fromFieldId}
          value={rehearsal.fromNodeId}
          disabled={!rehearsal.chapterId}
          onChange={(event) => rehearsal.chooseFrom(event.target.value)}
        >
          <option value="">Chapter start</option>
          {branch.starts.map((start) => (
            <option key={start.nodeId} value={start.nodeId}>
              {start.path}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

/** The chapters to practise (none selected: every enabled opening chapter), with their due counts. */
function ChapterChips({
  trainable,
  selected,
  hidden,
  onToggle
}: {
  trainable: readonly RepertoireChapterSummary[];
  selected: readonly string[];
  /** Hidden while rehearsing (a rehearsal picks one chapter), keeping the selection. */
  hidden: boolean;
  onToggle: (chapterId: string) => void;
}) {
  return (
    <div className={hidden ? "hidden" : "grid gap-2"}>
      <p className="text-xs font-medium text-fg-secondary">Chapters</p>
      {trainable.length ? (
        <div className="flex flex-wrap gap-1.5">
          {trainable.map((chapter) => (
            <ChipButton
              key={chapter.id}
              selected={selected.includes(chapter.id)}
              onClick={() => onToggle(chapter.id)}
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
        {selected.length
          ? `${selected.length} selected`
          : "None selected: every enabled opening chapter."}
      </p>
    </div>
  );
}

/** The saved auto-advance preference ("Next card"). */
function NextCardField({
  value,
  onChange
}: {
  value: PracticeAutoAdvanceMs;
  onChange: (delay: PracticeAutoAdvanceMs) => void;
}) {
  const id = useId();
  return (
    <Field
      label="Next card"
      hint="after a correct answer; one with notes waits for Next"
      htmlFor={id}
    >
      <Select
        id={id}
        className="sm:max-w-56"
        value={String(value)}
        onChange={(event) => {
          const delay = Number(event.target.value);
          if (isOneOf(PRACTICE_AUTO_ADVANCE_MS, delay)) onChange(delay);
        }}
      >
        {PRACTICE_AUTO_ADVANCE_MS.map((delay) => (
          <option key={delay} value={delay}>
            {ADVANCE_LABELS[delay]}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** Start, disabled with the reason beside it while nothing can start. */
function StartPracticeButton({
  mode,
  starting,
  unavailable,
  onStart
}: {
  mode: PracticeMode;
  starting: boolean;
  /** Why nothing can start (null: it can). */
  unavailable: string | null;
  onStart: () => void;
}) {
  const reasonId = useId();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button
        type="button"
        variant="primary"
        disabled={starting || unavailable !== null}
        aria-describedby={unavailable ? reasonId : undefined}
        onClick={onStart}
      >
        {mode === "rehearse-lines" ? <Route /> : <GraduationCap />}
        {starting ? "Starting…" : START_LABELS[mode]}
      </Button>
      {unavailable ? (
        <p id={reasonId} className="text-xs text-fg-muted">
          {unavailable}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The positions a rehearsal of `chapterId` can start from within the depth limit (loaded with the
 * chapter and the repertoire's paused decisions, which are played as context and never asked),
 * and whether one from the chapter start asks a move (`asks`; null until loaded). A preselected
 * branch ("Rehearse from here", e.g. where the opponent is to move) that the list leaves out is
 * offered too while a rehearsal can start there.
 */
function useRehearseStarts(
  detail: RepertoireDetail,
  chapterId: string | null,
  preselected: string,
  maxDepthPlies: number
): { starts: RehearseStart[]; truncated: boolean; asks: boolean | null; loading: boolean } {
  const chapter = useRepertoireChapterQuery(chapterId ? detail.id : null, chapterId);
  const pausedKeys = useRepertoirePausedKeysQuery(chapterId ? detail.id : null);
  const data = chapterId && chapter.data?.id === chapterId ? chapter.data : null;
  // A failed read of the paused decisions leaves none paused, as Study does.
  const pausedLoading = Boolean(chapterId) && pausedKeys.isPending;
  const listed = useMemo(() => {
    if (!data || pausedLoading) return { starts: [], truncated: false, asks: null };
    const paused = new Set(pausedKeys.data);
    const context = rehearsalContext(data, detail.color, { maxDepthPlies, paused });
    const asks = lineEnds(context, REPERTOIRE_ROOT_NODE_ID).length > 0;
    const result = {
      ...rehearseStarts(data, detail.color, pathLabel, { maxDepthPlies, paused }),
      asks
    };
    if (!preselected || result.starts.some((start) => start.nodeId === preselected)) return result;
    if (!canRehearseFrom(context, preselected)) return result;
    return {
      ...result,
      starts: [
        { nodeId: preselected, path: pathLabel(context.lookup, preselected) },
        ...result.starts
      ]
    };
  }, [data, pausedLoading, pausedKeys.data, detail.color, preselected, maxDepthPlies]);
  return { ...listed, loading: Boolean(chapterId) && (chapter.isPending || pausedLoading) };
}
