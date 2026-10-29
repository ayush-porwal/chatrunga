import { useMemo } from "react";
import { buildChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import { playerToMove } from "@chaturanga/shared/chess/repertoire-position";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type {
  RepertoireChapter,
  RepertoireChapterSummary,
  RepertoireColor
} from "@chaturanga/shared/types/repertoire";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OverflowMenu } from "@/components/ui/menu";
import { Notice } from "@/components/ui/notice";
import { useRepertoireOccurrencesQuery } from "../../queries/repertoire";
import { useOpeningOfQuery, usePractisedElsewhereQuery } from "../../queries/repertoire-study";
import { plural } from "./repertoire-chapters";
import { occurrencesInOtherChapters } from "./repertoire-model";
import { shownChapter, stagedLines, stagedSummary } from "./study-staging";

/** What the card's controls do; the page carries each out. */
type NewMovesActions = {
  /** Adds the staged moves to the open chapter (the player's study-only with `studyOnly`). */
  onAdd: (studyOnly: boolean) => void;
  /** Adds them to another chapter of the repertoire (opened next). */
  onAddTo: (chapterId: string) => void;
  /** Adds them to a new chapter named `title` (opened next). */
  onAddToNewChapter: (title: string) => void;
  /** Drops a staged move and what follows it. */
  onDrop: (nodeId: string) => void;
  onDiscard: () => void;
};

/** "1 new practice move" / "3 new practice moves" / "No new practice moves". */
function practiceMovesText(count: number): string {
  return count ? plural(count, "new practice move") : "No new practice moves";
}

/**
 * The New moves card (docs/repertoire-games-and-practice.md §3 "Staged moves"): the staged moves
 * as chips with × (dropping that move and what follows), one sentence per decision adding them
 * changes, how many practice moves it adds, and Add (to this chapter, another one, or a new one
 * named after the line's opening), Add as study-only and Discard. Shown while the staged moves
 * apply to the selected line.
 */
export function StudyNewMovesCard({
  repertoireId,
  chapter,
  staged,
  color,
  chapters,
  busy,
  ...actions
}: {
  repertoireId: string;
  /** The draft (without the staged moves). */
  chapter: RepertoireChapter;
  staged: readonly MoveNode[];
  color: RepertoireColor;
  /** The repertoire's chapters, in order. */
  chapters: readonly RepertoireChapterSummary[];
  busy: boolean;
} & NewMovesActions) {
  // Where the staged moves of the player's are played, and where the line ends: what the other
  // chapters practise there, and another chapter the line transposes into.
  const { ownKeys, endKey } = useMemo(() => {
    const lookup = buildChapterLookup(shownChapter(chapter, staged));
    const keys = staged
      .filter((node) => playerToMove(node.fenBefore) === color && node.parentId)
      .map((node) => lookup.positionKeys.get(node.parentId!)!)
      .filter(Boolean);
    const leaf = staged.filter((node) => !node.children.length).at(-1);
    return {
      ownKeys: [...new Set(keys)].sort(),
      endKey: leaf ? (lookup.positionKeys.get(leaf.id) ?? null) : null
    };
  }, [chapter, staged, color]);
  const elsewhere = usePractisedElsewhereQuery(repertoireId, chapter.id, ownKeys);
  const occurrences = useRepertoireOccurrencesQuery(repertoireId, endKey);
  const transposesTo =
    occurrencesInOtherChapters(occurrences.data ?? [], chapter.id).at(0)?.chapterTitle ?? null;
  const summary = useMemo(
    () =>
      stagedSummary({
        chapter,
        staged,
        color,
        practisedElsewhere: elsewhere.data,
        transposesTo
      }),
    [chapter, staged, color, elsewhere.data, transposesTo]
  );
  const line = useMemo(() => stagedLines(chapter.tree, staged).at(0) ?? [], [chapter, staged]);
  const opening = useOpeningOfQuery(chapter.rootFen, line);
  const newTitle = opening.data?.name ?? "New chapter";
  const count = summary.chips.length;
  const others = chapters.filter((item) => item.id !== chapter.id);

  return (
    <Notice tone="info" title="New moves" aria-label="New moves">
      <div className="grid gap-2">
        <ul className="flex flex-wrap gap-1" aria-label="Staged moves">
          {summary.chips.map((chip) => (
            <li key={chip.nodeId}>
              <Badge
                tone="warn"
                size="md"
                className="font-mono"
                onRemove={() => actions.onDrop(chip.nodeId)}
                removeLabel={`Drop ${chip.label}`}
              >
                {chip.label}
              </Badge>
            </li>
          ))}
        </ul>
        {summary.sentences.map((sentence) => (
          <p key={sentence}>{sentence}</p>
        ))}
        <p className="text-fg-muted">{practiceMovesText(summary.practiceMoves)}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="primary"
            size="xs"
            disabled={busy}
            onClick={() => actions.onAdd(false)}
          >
            Add {plural(count, "move")}
          </Button>
          <OverflowMenu
            label="Add to another chapter"
            trigger={{ text: "Add to…", variant: "outline", compact: true }}
            items={[
              ...others.map((item) => ({
                label: item.title,
                disabled: busy,
                onSelect: () => actions.onAddTo(item.id)
              })),
              {
                label: `New chapter — ${newTitle}`,
                disabled: busy,
                divided: true,
                onSelect: () => actions.onAddToNewChapter(newTitle)
              }
            ]}
          />
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={busy}
            onClick={() => actions.onAdd(true)}
          >
            Add as study-only
          </Button>
          <Button type="button" variant="ghost" size="xs" onClick={actions.onDiscard}>
            Discard
          </Button>
        </div>
      </div>
    </Notice>
  );
}
