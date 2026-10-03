import { useId, useMemo, useState } from "react";
import { GraduationCap, Route } from "lucide-react";
import {
  DEFAULT_REHEARSAL_DEPTH_PLIES,
  canRehearseFrom,
  rehearsalContext
} from "@chaturanga/shared/chess/repertoire-rehearsal";
import type {
  PracticeMode,
  RepertoireDetail,
  StartPracticeInput
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
import { useRepertoireChapterQuery } from "../../queries/repertoire";
import { useSetSetting } from "../settings/use-set-setting";
import { sortedChapters } from "./repertoire-chapters";
import { pathLabel } from "./repertoire-model";
import { startUnavailableReason } from "./training-explanations";
import { PracticeEmptyState } from "./PracticeEmptyState";
import {
  DEFAULT_CARD_LIMIT,
  DEFAULT_NEW_CARD_LIMIT,
  MAX_CARD_LIMIT,
  MAX_DEPTH_PLIES,
  MAX_REHEARSE_STARTS,
  boundedInt,
  explainedChapterIds,
  practiceInputFromForm,
  rehearseStarts,
  type RehearseStart
} from "./practice-setup";

export { initialPracticeInput } from "./practice-setup";

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
  const ids = {
    depth: useId(),
    cards: useId(),
    fresh: useId(),
    chapter: useId(),
    from: useId(),
    advance: useId(),
    startReason: useId()
  };
  const settings = useSettingsQuery();
  const setSetting = useSetSetting();
  const advanceMs = settings.data?.practiceAutoAdvanceMs ?? defaultSettings.practiceAutoAdvanceMs;
  const [mode, setMode] = useState<PracticeMode>(initial.mode);
  const [chapterIds, setChapterIds] = useState<string[]>(initial.chapterIds ?? []);
  const [depth, setDepth] = useState(initial.maxDepthPlies ? String(initial.maxDepthPlies) : "");
  const [cards, setCards] = useState(String(initial.cardLimit ?? DEFAULT_CARD_LIMIT));
  const [fresh, setFresh] = useState(String(initial.newCardLimit ?? DEFAULT_NEW_CARD_LIMIT));
  const trainable = sortedChapters(detail.chapters).filter(
    (chapter) => chapter.kind === "opening" && chapter.enabled
  );
  const rehearsing = mode === "rehearse-lines";
  const [rehearseChapterId, setRehearseChapterId] = useState(
    initial.rehearse?.chapterId ?? initial.chapterIds?.[0] ?? trainable[0]?.id ?? ""
  );
  const [fromNodeId, setFromNodeId] = useState(initial.rehearse?.fromNodeId ?? "");
  const branch = useRehearseStarts(
    detail,
    rehearsing && rehearseChapterId ? rehearseChapterId : null,
    initial.rehearse?.chapterId === rehearseChapterId ? (initial.rehearse.fromNodeId ?? "") : "",
    boundedInt(depth, 1, MAX_DEPTH_PLIES) ?? DEFAULT_REHEARSAL_DEPTH_PLIES
  );
  // A branch that is no longer in the chapter starts from the chapter start (once it's loaded).
  const effectiveFrom =
    branch.loading || branch.starts.some((start) => start.nodeId === fromNodeId) ? fromNodeId : "";

  const input = (override?: PracticeMode): StartPracticeInput =>
    practiceInputFromForm({
      repertoireId: detail.id,
      mode: override ?? mode,
      chapterIds,
      depth,
      cards,
      fresh,
      rehearseChapterId,
      rehearseFromNodeId: effectiveFrom
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
    rehearseChapterId
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
          <SectionHeader
            title="Practice"
            description={
              rehearsing
                ? "Play your moves along the chapter's lines; replies are supplied from the chapter. Results stay in this session."
                : "One decision at a time: play any move you accepted for the position."
            }
          />
          <SegmentedControl
            ariaLabel="Practice mode"
            value={mode}
            onChange={setMode}
            options={modeOptions}
          />
          {rehearsing ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Chapter" htmlFor={ids.chapter}>
                <Select
                  id={ids.chapter}
                  value={rehearseChapterId}
                  disabled={!trainable.length}
                  onChange={(event) => {
                    setRehearseChapterId(event.target.value);
                    setFromNodeId("");
                  }}
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
                htmlFor={ids.from}
              >
                <Select
                  id={ids.from}
                  value={effectiveFrom}
                  disabled={!rehearseChapterId}
                  onChange={(event) => setFromNodeId(event.target.value)}
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
          ) : null}
          <div className={rehearsing ? "hidden" : "grid gap-2"}>
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
            <Field
              label="Next card"
              hint="after a correct answer; one with notes waits for Next"
              htmlFor={ids.advance}
            >
              <Select
                id={ids.advance}
                className="sm:max-w-56"
                value={String(advanceMs)}
                onChange={(event) =>
                  setSetting(
                    "practiceAutoAdvanceMs",
                    Number(event.target.value) as PracticeAutoAdvanceMs
                  )
                }
              >
                {PRACTICE_AUTO_ADVANCE_MS.map((delay) => (
                  <option key={delay} value={delay}>
                    {ADVANCE_LABELS[delay]}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button
              type="button"
              variant="primary"
              disabled={starting || unavailable !== null}
              aria-describedby={unavailable ? ids.startReason : undefined}
              onClick={() => onStart(input())}
            >
              {rehearsing ? <Route /> : <GraduationCap />}
              {starting ? "Starting…" : START_LABELS[mode]}
            </Button>
            {unavailable ? (
              <p id={ids.startReason} className="text-xs text-fg-muted">
                {unavailable}
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * The positions a rehearsal of `chapterId` can start from within the depth limit (loaded with the
 * chapter). A preselected branch ("Rehearse from here", e.g. where the opponent is to move) that
 * the list leaves out is offered too while a rehearsal can start there.
 */
function useRehearseStarts(
  detail: RepertoireDetail,
  chapterId: string | null,
  preselected: string,
  maxDepthPlies: number
): { starts: RehearseStart[]; truncated: boolean; loading: boolean } {
  const chapter = useRepertoireChapterQuery(chapterId ? detail.id : null, chapterId);
  const data = chapterId && chapter.data?.id === chapterId ? chapter.data : null;
  const listed = useMemo(() => {
    if (!data) return { starts: [], truncated: false };
    const result = rehearseStarts(data, detail.color, pathLabel, undefined, maxDepthPlies);
    if (!preselected || result.starts.some((start) => start.nodeId === preselected)) return result;
    const context = rehearsalContext(data, detail.color, maxDepthPlies);
    if (!canRehearseFrom(context, preselected)) return result;
    return {
      ...result,
      starts: [
        { nodeId: preselected, path: pathLabel(context.lookup, preselected) },
        ...result.starts
      ]
    };
  }, [data, detail.color, preselected, maxDepthPlies]);
  return { ...listed, loading: Boolean(chapterId) && chapter.isPending };
}
