import { GraduationCap, RotateCcw } from "lucide-react";
import type { ChapterPracticeStats } from "@chaturanga/shared/types/repertoire-practice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { eyebrow } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useRepertoireQuery } from "../../queries/repertoire";
import { chapterFamilies, openingVariation } from "./hub-groups";
import { plural } from "./repertoire-chapters";

/**
 * A hub row's chapters (its expander), grouped by opening family ("Caro-Kann Defense · 7
 * chapters"): each chapter's title (opens Study there), ECO, variation, kind when it is a
 * reference chapter, its moves and due count, and Practice (that chapter only). Every row has one
 * fixed height, and while the chapters load their placeholder rows take the same room, so opening
 * the list doesn't jump.
 */

/** One chapter row (and its placeholder): the same height with or without Practice. */
const row =
  "grid h-9 grid-cols-[minmax(0,1.4fr)_3.5rem_minmax(0,1.6fr)_auto_5.75rem] items-center gap-3 rounded-md px-2";
/** A family's heading line. */
const familyHeading = cn(eyebrow, "flex h-5 items-center");
/** The chapters' panel: sunken under the repertoire's row, a hairline between them. */
const panel = "border-t border-line-subtle bg-surface-sunken py-3 pr-3 pl-12";
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
        className={cn(panel, "grid gap-1")}
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
    <div className={cn(panel, "grid gap-3")}>
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
                <li
                  key={chapter.id}
                  className={cn(
                    row,
                    "group/row relative transition-colors duration-micro hover:bg-control focus-within:bg-control"
                  )}
                >
                  {/* The row's own action: the button covers the whole row (Practice sits above it). */}
                  <button
                    type="button"
                    className="truncate text-left text-[0.8125rem] font-medium text-fg-secondary outline-none after:absolute after:inset-0 after:rounded-md after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-accent/50"
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
                  <span className="whitespace-nowrap text-[0.8125rem] text-fg-muted tabular-nums">
                    {plural(counts?.moves ?? 0, "move")} · {counts?.due ?? chapter.dueCount} due
                  </span>
                  {chapter.kind === "opening" && chapter.enabled ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      className="relative z-10"
                      aria-label={`Practice ${chapter.title}`}
                      onClick={() => onPractiseChapter(chapter.id)}
                    >
                      <GraduationCap />
                      Practice
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
