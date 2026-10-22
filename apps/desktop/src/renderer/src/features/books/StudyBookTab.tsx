import { useState } from "react";
import { BookOpen, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import type { BookPages } from "@chaturanga/shared/types/books";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { bookPageLabel } from "./book-model";

/**
 * Study's Book tab: the page of the book the selected move is on (its nearest `[%page N]`), fit to
 * the panel's width, turned with Previous / Next page, or the page's text as read instead. Only
 * buttons: the arrow keys keep stepping through the moves.
 */
export function StudyBookTab({
  pages,
  page,
  onPage
}: {
  /** The book's pages (null while they load). */
  pages: BookPages | null;
  /** The 1-based PDF page shown (null: the position has none). */
  page: number | null;
  onPage: (page: number) => void;
}) {
  const [showText, setShowText] = useState(false);
  if (!pages) {
    return (
      <div className="grid h-full place-items-center" role="status" aria-label="Loading the book">
        <Loader2 className="size-5 animate-spin text-fg-subtle" />
      </div>
    );
  }
  if (page === null) {
    return (
      <EmptyState
        icon={<BookOpen />}
        title="No book page here"
        description="This position isn't linked to a page of the book."
      />
    );
  }
  const entry = pages.pages.find((item) => item.pageIndex === page - 1) ?? null;
  const label = bookPageLabel(pages, page);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line-subtle px-2">
        <IconButton
          label="Previous page"
          icon={<ChevronLeft />}
          size="icon-xs"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        />
        <span
          className="min-w-12 text-center text-xs font-medium text-fg tabular-nums"
          title={label.title}
          aria-live="polite"
        >
          {label.text}
        </span>
        <IconButton
          label="Next page"
          icon={<ChevronRight />}
          size="icon-xs"
          disabled={page >= pages.pages.length}
          onClick={() => onPage(page + 1)}
        />
        <span className="min-w-0 flex-1 truncate px-2 text-xs text-fg-muted" title={pages.title}>
          {pages.title}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-pressed={showText}
          className={showText ? "bg-control text-fg" : undefined}
          onClick={() => setShowText(!showText)}
        >
          Text
        </Button>
      </div>
      <div className="scroll-area min-h-0 flex-1 overflow-y-auto p-3">
        {showText ? (
          entry?.ocrText ? (
            <p className="text-xs leading-relaxed whitespace-pre-wrap break-words text-fg-secondary">
              {entry.ocrText}
            </p>
          ) : (
            <EmptyState compact title="This page wasn't read." />
          )
        ) : entry?.src ? (
          <img
            src={entry.src}
            alt={`Book ${label.text}`}
            className="h-auto w-full rounded-md border border-line-subtle"
            draggable={false}
          />
        ) : (
          <EmptyState compact title="This page's image is missing." />
        )}
      </div>
    </div>
  );
}
