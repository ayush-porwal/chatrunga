import { useState } from "react";
import { BookOpen, FolderOpen, Play, RotateCcw, Square, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { BookSummary } from "@chaturanga/shared/types/books";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { runBookAction, useBookImportStore } from "./book-imports";
import { bookRowState, formatUsd, type BookAction, type BookRowState } from "./book-model";

/** Thumbnail slot · title and stage · progress · cost · actions (the repertoire table's rhythm). */
const columns =
  "grid grid-cols-[5.5rem_minmax(0,1.8fr)_minmax(0,2fr)_minmax(0,1fr)_minmax(9.5rem,auto)] gap-x-4 pr-3";

/**
 * The books being imported, as rows above the repertoires (a book becomes a repertoire row once
 * done): its title, the stage under way, progress, what it has cost so far, and its actions,
 * always shown: Cancel, Resume (or Start, Retry, Continue) and Remove (asked first).
 * `onContinue` picks the same PDF again for an import whose pages weren't all sent.
 */
export function BookImportRows({
  books,
  onContinue
}: {
  books: readonly BookSummary[];
  onContinue: (book: BookSummary) => void;
}) {
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<BookSummary | null>(null);
  if (!books.length) return null;
  const act = (book: BookSummary, action: BookAction) => {
    if (action === "continue") onContinue(book);
    else if (action === "remove") setRemoving(book);
    else void runBookAction(book.id, action, queryClient);
  };
  return (
    <>
      <ul aria-label="Books being imported">
        {books.map((book) => (
          <BookImportRow key={book.id} book={book} onAction={(action) => act(book, action)} />
        ))}
      </ul>
      {removing ? (
        <Dialog
          size="sm"
          title={`Remove “${removing.title}”?`}
          description="Its saved pages and everything read from them are deleted; importing it again starts over (and is paid for again)."
          onClose={() => setRemoving(null)}
          footer={
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => setRemoving(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="ghost-destructive"
                size="sm"
                onClick={() => {
                  void runBookAction(removing.id, "remove", queryClient);
                  setRemoving(null);
                }}
              >
                <Trash2 />
                Remove book
              </Button>
            </>
          }
        />
      ) : null}
    </>
  );
}

function BookImportRow({
  book,
  onAction
}: {
  book: BookSummary;
  onAction: (action: BookAction) => void;
}) {
  const event = useBookImportStore((state) => state.events[book.id] ?? null);
  const upload = useBookImportStore((state) => state.uploads[book.id] ?? null);
  const actionError = useBookImportStore((state) => state.errors[book.id] ?? null);
  const busy = useBookImportStore((state) => state.busy.has(book.id));
  const row = bookRowState(book, event, upload, actionError);
  return (
    <li
      aria-label={book.title}
      className={cn(columns, "min-h-22 items-center border-t border-line-subtle py-3")}
    >
      <span className="grid h-16 place-items-center self-stretch text-fg-subtle" aria-hidden="true">
        <BookOpen className="size-5" />
      </span>
      <span className="grid min-w-0 gap-1">
        <span className="truncate text-sm font-medium text-fg">{book.title}</span>
        <span className={cn("text-xs", row.status === "failed" ? "text-danger" : "text-fg-muted")}>
          {row.label}
        </span>
        {row.error ? (
          <span className="text-xs leading-5 text-danger" role="alert">
            {row.error}
          </span>
        ) : null}
      </span>
      <BookProgress row={row} />
      <span className="text-xs text-fg-secondary tabular-nums" title="Charged by OpenRouter so far">
        {formatUsd(row.costUsd)}
      </span>
      <span className="flex items-center justify-end gap-1 justify-self-end">
        {row.actions.map((action) => (
          <BookActionButton
            key={action}
            action={action}
            title={book.title}
            disabled={busy}
            onSelect={() => onAction(action)}
          />
        ))}
      </span>
    </li>
  );
}

/** The stage's bar and "n / N"; an indeterminate bar while running with no count yet. */
function BookProgress({ row }: { row: BookRowState }) {
  const { progress } = row;
  if (!progress && row.status !== "running") return <span />;
  const value = progress ? (progress.done / Math.max(progress.total, 1)) * 100 : null;
  return (
    <span className="grid min-w-0 gap-1">
      <Progress value={value} aria-label={`${row.label} progress`} />
      {progress ? (
        <span className="text-2xs text-fg-subtle tabular-nums">
          {progress.done.toLocaleString("en-US")} / {progress.total.toLocaleString("en-US")}
        </span>
      ) : null}
    </span>
  );
}

const ACTION_LABELS: Record<BookAction, string> = {
  cancel: "Cancel",
  start: "Start",
  resume: "Resume",
  retry: "Retry",
  continue: "Continue",
  remove: "Remove"
};

const ACTION_ICONS: Record<BookAction, typeof Play> = {
  cancel: Square,
  start: Play,
  resume: Play,
  retry: RotateCcw,
  continue: FolderOpen,
  remove: Trash2
};

function BookActionButton({
  action,
  title,
  disabled,
  onSelect
}: {
  action: BookAction;
  title: string;
  disabled: boolean;
  onSelect: () => void;
}) {
  const Icon = ACTION_ICONS[action];
  const primary = action === "resume" || action === "retry" || action === "start";
  return (
    <Button
      type="button"
      size="xs"
      variant={action === "remove" ? "ghost-destructive" : primary ? "primary" : "outline"}
      aria-label={`${ACTION_LABELS[action]} ${title}`}
      disabled={disabled}
      onClick={onSelect}
    >
      <Icon />
      {ACTION_LABELS[action]}
    </Button>
  );
}
