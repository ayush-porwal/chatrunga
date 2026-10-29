import { GraduationCap, RotateCcw } from "lucide-react";
import type { ChapterPracticeStats } from "@chaturanga/shared/types/repertoire-practice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { useRepertoireQuery } from "../../queries/repertoire";
import { chapterFamilies, openingVariation } from "./hub-groups";
import { plural } from "./repertoire-chapters";

/**
 * A hub row's chapters (its expander), grouped by opening family ("Caro-Kann Defense · 7
 * chapters"): each chapter's title (opens Study there), ECO, variation, kind when it is a
 * reference chapter, its moves and due count, and Practise (that chapter only). Every row has one
 * fixed height, and while the chapters load their placeholder rows take the same room, so opening
 * the list doesn't jump.
 */

/** One chapter row (and its placeholder): the same height with or without Practise. */
const row =
  "grid h-9 grid-cols-[minmax(0,1.4fr)_3.5rem_minmax(0,1.6fr)_auto_5.75rem] items-center gap-3 rounded-md px-2";
/** A family's heading line. */
const familyHeading = "flex h-5 items-center text-xs font-medium text-fg-muted";
export function HubChapterList({
  repertoireId,
  name,
  chapterCount,
  stats,
  onStudyChapter,
  onPractiseChapter
}: {
  repertoireId: string;
  name: string;
  /** How many chapters it has: the placeholder's rows while they load. */
  chapterCount: number;
  /** Each chapter's moves and due count (the Practice overview), by chapter id. */
  stats: ReadonlyMap<string, ChapterPracticeStats>;
  onStudyChapter: (chapterId: string) => void;
  onPractiseChapter: (chapterId: string) => void;
}) {
  const detail = useRepertoireQuery(repertoireId);
  if (detail.isPending) {
    return (
      <div
        aria-busy="true"
        aria-label={`Loading the chapters of ${name}`}
        className="grid gap-1 bg-surface-sunken/50 py-3 pr-3 pl-12"
      >
        <span className={familyHeading}>
          <Skeleton className="h-3 w-48" />
        </span>
        <span className="grid gap-0.5">
          {Array.from({ length: Math.max(1, chapterCount) }, (_, index) => (
            <span key={index} className={row}>
              <Skeleton className="h-3 w-56" />
            </span>
          ))}
        </span>
      </div>
    );
  }
  if (detail.isError) {
    return (
      <div className="py-3 pr-3 pl-12">
        <Notice
          tone="danger"
          title="Couldn't load the chapters"
          action={
            <Button type="button" variant="outline" size="xs" onClick={() => void detail.refetch()}>
              <RotateCcw />
              Try again
            </Button>
          }
        >
          {ipcErrorMessage(detail.error)}
        </Notice>
      </div>
    );
  }
  const families = chapterFamilies(detail.data.chapters);
  if (!families.length) {
    return <p className="py-3 pr-3 pl-12 text-xs text-fg-muted">No chapters yet.</p>;
  }
  return (
    <div className="grid gap-3 bg-surface-sunken/50 py-3 pr-3 pl-12">
      {families.map(({ family, chapters }) => (
        <section key={family} aria-label={family} className="grid gap-1">
          <p className={familyHeading}>
            {family} · {plural(chapters.length, "chapter")}
          </p>
          <ul className="grid gap-0.5">
            {chapters.map((chapter) => {
              const counts = stats.get(chapter.id);
              const variation = chapter.opening?.name ? openingVariation(chapter.opening.name) : "";
              return (
                <li key={chapter.id} className={`${row} hover:bg-control`}>
                  <button
                    type="button"
                    className="truncate text-left text-sm text-fg outline-none hover:underline focus-visible:underline"
                    aria-label={`Study ${chapter.title}`}
                    onClick={() => onStudyChapter(chapter.id)}
                  >
                    {chapter.title}
                  </button>
                  <span className="flex">
                    {chapter.opening?.eco ? <Badge>{chapter.opening.eco}</Badge> : null}
                  </span>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-xs text-fg-subtle">{variation}</span>
                    {chapter.kind === "reference" ? <Badge>Reference</Badge> : null}
                  </span>
                  <span className="text-xs whitespace-nowrap text-fg-muted tabular-nums">
                    {plural(counts?.moves ?? 0, "move")} · {counts?.due ?? chapter.dueCount} due
                  </span>
                  {chapter.kind === "opening" && chapter.enabled ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      aria-label={`Practise ${chapter.title}`}
                      onClick={() => onPractiseChapter(chapter.id)}
                    >
                      <GraduationCap />
                      Practise
                    </Button>
                  ) : (
                    <span />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
