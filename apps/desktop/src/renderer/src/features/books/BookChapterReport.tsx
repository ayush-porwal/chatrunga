import type { BookChapterSummary, BookPages } from "@chaturanga/shared/types/books";
import { Disclosure } from "@/components/ui/disclosure";
import { focusRing, listRow, motion } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { bookPageLabel, chapterReportSummary } from "./book-model";

/**
 * How the open chapter was rebuilt from its book chapter, in one quiet line ("1,477 moves · 6
 * lines need a look") that unfolds to what to check: each line still illegal, and each page
 * whose lines couldn't be read, with its page; choosing one shows that page (`onOpenPage`).
 */
export function BookChapterReport({
  pages,
  chapterId,
  onOpenPage
}: {
  /** The book's pages (null: not a book's repertoire, or not read yet). */
  pages: BookPages | null;
  chapterId: string;
  onOpenPage: (page: number) => void;
}) {
  const chapter: BookChapterSummary | undefined = pages?.chapters.find(
    (entry) => entry.repertoireChapterId === chapterId
  );
  if (!pages || !chapter?.report) return null;
  const { text, issues } = chapterReportSummary(chapter.report);
  const title = `From the book: ${text}`;
  if (!issues.length) return <p className="px-2 text-xs text-fg-muted">{title}</p>;
  return (
    <section aria-label="From the book">
      <Disclosure title={<span className="text-xs font-normal text-fg-muted">{title}</span>}>
        <ul className="grid gap-1">
          {issues.map((issue, index) => (
            <li key={`${issue.page}-${index}`}>
              <button
                type="button"
                className={cn(
                  listRow,
                  motion.colors,
                  focusRing,
                  "min-h-9 cursor-pointer gap-2 px-2 py-1.5 hover:bg-control"
                )}
                onClick={() => onOpenPage(issue.page)}
              >
                <PageLabel pages={pages} page={issue.page} />
                <span className="grid min-w-0 gap-0.5">
                  {issue.label ? (
                    <span className="truncate text-xs font-medium text-fg">{issue.label}</span>
                  ) : null}
                  <span className="text-xs text-fg-muted">{issue.error}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Disclosure>
    </section>
  );
}

function PageLabel({ pages, page }: { pages: BookPages; page: number }) {
  const label = bookPageLabel(pages, page);
  return (
    <span className="shrink-0 font-mono text-2xs text-fg-subtle" title={label.title}>
      {label.text}
    </span>
  );
}
