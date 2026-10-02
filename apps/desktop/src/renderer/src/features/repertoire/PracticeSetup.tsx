import { useId, useMemo, useState } from "react";
import { GraduationCap, Route, Sparkles } from "lucide-react";
import { buildChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import type {
  PracticeMode,
  RepertoireDetail,
  StartPracticeInput
} from "@chaturanga/shared/types/repertoire";
import { ChipButton } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { SectionHeader } from "@/components/ui/page";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cardPadded } from "@/lib/ui";
import { useRepertoireChapterQuery } from "../../queries/repertoire";
import { sortedChapters } from "./repertoire-chapters";
import { pathLabel } from "./repertoire-model";
import {
  DEFAULT_CARD_LIMIT,
  DEFAULT_NEW_CARD_LIMIT,
  MAX_CARD_LIMIT,
  MAX_DEPTH_PLIES,
  MAX_REHEARSE_STARTS,
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

const START_LABELS: Record<PracticeMode, string> = {
  "review-due": "Start review",
  "learn-new": "Start learning",
  "rehearse-lines": "Start rehearsal"
};

/**
 * Practice setup (§5.3): mode, chapters (none selected = every enabled opening chapter), maximum
 * depth and card limits. "Nothing due" offers Learn new instead. Rehearse lines picks one chapter
 * and optionally a branch to start from; card limits don't apply to it.
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
  const ids = {
    depth: useId(),
    cards: useId(),
    fresh: useId(),
    chapter: useId(),
    from: useId()
  };
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
    initial.rehearse?.chapterId === rehearseChapterId ? (initial.rehearse.fromNodeId ?? "") : ""
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
        ) : nothingDue === "rehearse-lines" ? (
          <Notice tone="info" title="Nothing to rehearse here">
            This chapter or branch has no moves of yours in training. Accept moves while studying,
            or choose another place to start.
          </Notice>
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
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Button
            type="button"
            variant="primary"
            className="justify-self-start"
            disabled={starting || !trainable.length || (rehearsing && !rehearseChapterId)}
            onClick={() => onStart(input())}
          >
            {rehearsing ? <Route /> : <GraduationCap />}
            {starting ? "Starting…" : START_LABELS[mode]}
          </Button>
        </section>
      </div>
    </div>
  );
}

/**
 * The positions a rehearsal of `chapterId` can start from (loaded with the chapter). A preselected
 * branch ("Rehearse from here") that the list leaves out is offered too while it is in the chapter.
 */
function useRehearseStarts(
  detail: RepertoireDetail,
  chapterId: string | null,
  preselected: string
): { starts: RehearseStart[]; truncated: boolean; loading: boolean } {
  const chapter = useRepertoireChapterQuery(chapterId ? detail.id : null, chapterId);
  const data = chapterId && chapter.data?.id === chapterId ? chapter.data : null;
  const listed = useMemo(() => {
    if (!data) return { starts: [], truncated: false };
    const result = rehearseStarts(data, detail.color, pathLabel);
    if (!preselected || result.starts.some((start) => start.nodeId === preselected)) return result;
    const lookup = buildChapterLookup(data);
    if (!lookup.nodesById.has(preselected)) return result;
    return {
      ...result,
      starts: [{ nodeId: preselected, path: pathLabel(lookup, preselected) }, ...result.starts]
    };
  }, [data, detail.color, preselected]);
  return { ...listed, loading: Boolean(chapterId) && chapter.isPending };
}
