import { useEffect, useId, useRef, useState } from "react";
import { FileText, Loader2, Settings } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { BookEstimate, BookSummary } from "@chaturanga/shared/types/books";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { useOpenRouterConfigQuery } from "../../queries/api";
import { useBookEstimateQuery } from "../../queries/books";
import { continueBook, importBook } from "./book-imports";
import { fileTitle, formatMinutes, formatUsd, sameBookFile } from "./book-model";
import { openPdfBook, type PdfBook } from "./render-pdf";

type Opened = { file: File; pdf: PdfBook };

const closeQuietly = (pdf: PdfBook) => void pdf.close().catch(() => undefined);

/**
 * Import book (PDF): pick a PDF, check its title, page count, the expected cost and time and the
 * two models that will read it, then Start. The pages are rendered and sent, and the import runs,
 * on their own (book-imports.ts): the dialog closes as soon as the book exists. Without a saved
 * OpenRouter key it explains why one is needed and offers Settings instead. With `book` (an import
 * whose pages weren't all sent before the app closed) it asks for the same file again and sends
 * only the pages missing.
 */
export function BookImportDialog({
  book = null,
  onClose,
  onOpenSettings
}: {
  book?: BookSummary | null;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const queryClient = useQueryClient();
  const config = useOpenRouterConfigQuery();
  const [title, setTitle] = useState("");
  const [starting, setStarting] = useState(false);
  const choice = usePdfChoice(book, (opened) =>
    setTitle(opened.pdf.metadataTitle ?? fileTitle(opened.file.name))
  );
  const { opened } = choice;
  const needsKey = config.isSuccess && !config.data.hasApiKey;
  const trimmedTitle = title.trim();
  const canStart =
    Boolean(opened) && config.isSuccess && !needsKey && !starting && Boolean(book || trimmedTitle);

  const start = () => {
    const pdf = canStart ? choice.take() : null;
    if (!opened || !pdf) return;
    choice.setError(null);
    if (book) {
      // The same file: the upload takes it and sends what is missing.
      void continueBook(book, pdf, queryClient);
      onClose();
      return;
    }
    setStarting(true);
    const request = choice.request();
    // Unchanged, the title read from the book's pages may replace it.
    const suggested = pdf.metadataTitle ?? fileTitle(opened.file.name);
    importBook({
      pdf,
      sourceName: opened.file.name,
      title: trimmedTitle === suggested ? null : trimmedTitle,
      queryClient
    }).then(onClose, (cause: unknown) => {
      if (!choice.giveBack(pdf, request)) return;
      setStarting(false);
      choice.setError(ipcErrorMessage(cause) || "The import couldn't start.");
    });
  };

  return (
    <Dialog
      size="sm"
      {...dialogText(book)}
      onClose={onClose}
      bodyClassName="grid gap-4"
      footer={
        <>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          {needsKey ? (
            <Button type="button" variant="primary" size="sm" onClick={onOpenSettings}>
              <Settings />
              Open Settings
            </Button>
          ) : (
            <Button type="button" variant="primary" size="sm" disabled={!canStart} onClick={start}>
              {starting ? <Loader2 className="animate-spin" /> : null}
              {book ? "Continue" : "Start"}
            </Button>
          )}
        </>
      }
    >
      {needsKey ? (
        <Notice tone="info" title="An OpenRouter API key is needed">
          Reading the pages and building the lines use OpenRouter on your own key. Add one in
          Settings → AI, then import the book.
        </Notice>
      ) : null}
      <BookFilePicker opened={opened} opening={choice.opening} onChoose={choice.choose} />
      {choice.error ? <Notice tone="danger">{choice.error}</Notice> : null}
      {opened ? (
        <OpenedBook
          opened={opened}
          continuing={book !== null}
          title={title}
          onTitleChange={setTitle}
          fallbackModels={config.data ? [config.data.bookOcrModel, config.data.model] : null}
        />
      ) : null}
    </Dialog>
  );
}

/** The dialog's title and description: a new book, or continuing `book`'s upload. */
function dialogText(book: BookSummary | null): { title: string; description: string } {
  if (!book) {
    return {
      title: "Import a book",
      description:
        "A chess book's pages are read by AI and turned into a repertoire, one chapter per chapter of the book."
    };
  }
  return {
    title: `Continue “${book.title}”`,
    description: `Pick “${book.sourceName}” again to save its remaining pages (${book.pagesAdded} of ${book.pageCount} saved).`
  };
}

/** The opened PDF: its title (a new book's only), then its facts. */
function OpenedBook({
  opened,
  continuing,
  title,
  onTitleChange,
  fallbackModels
}: {
  opened: Opened;
  continuing: boolean;
  title: string;
  onTitleChange: (title: string) => void;
  fallbackModels: [string, string] | null;
}) {
  const titleId = useId();
  const estimate = useBookEstimateQuery(opened.pdf.pageCount);
  return (
    <>
      {continuing ? null : (
        <Field label="Title" htmlFor={titleId} hint="Kept for the repertoire">
          <Input
            id={titleId}
            value={title}
            maxLength={300}
            onChange={(event) => onTitleChange(event.target.value)}
          />
        </Field>
      )}
      <BookFacts
        pageCount={opened.pdf.pageCount}
        estimate={estimate.data}
        estimateFailed={estimate.isError}
        fallbackModels={fallbackModels}
        continuing={continuing}
      />
    </>
  );
}

/**
 * The PDF picked in the dialog: opened (and, to continue `book`, checked to be its file), held
 * until the import takes it (`take`), and closed when replaced or when the dialog closes unused.
 * A PDF that opens after a newer pick, or after the dialog closed, is let go.
 */
function usePdfChoice(book: BookSummary | null, onOpened: (opened: Opened) => void) {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const held = useRef<PdfBook | null>(null);
  /** Bumped per pick, and when the dialog closes. */
  const pick = useRef(0);

  useEffect(
    () => () => {
      pick.current += 1;
      if (held.current) closeQuietly(held.current);
      held.current = null;
    },
    []
  );

  const choose = (file: File) => {
    const request = ++pick.current;
    if (held.current) closeQuietly(held.current);
    held.current = null;
    setOpened(null);
    setError(null);
    setOpening(true);
    openPdfBook(file).then(
      (pdf) => {
        if (request !== pick.current) return closeQuietly(pdf);
        setOpening(false);
        const mismatch = book && sameBookFile(book, pdf);
        if (mismatch) {
          closeQuietly(pdf);
          setError(mismatch);
          return;
        }
        held.current = pdf;
        setOpened({ file, pdf });
        onOpened({ file, pdf });
      },
      () => {
        if (request !== pick.current) return;
        setOpening(false);
        setError("This file couldn't be opened as a PDF.");
      }
    );
  };

  return {
    opened,
    opening,
    error,
    setError,
    choose,
    /** Hands the PDF over (closing the dialog no longer closes it). */
    take: (): PdfBook | null => {
      const pdf = held.current;
      held.current = null;
      return pdf;
    },
    /** The pick a hand-over belongs to. */
    request: () => pick.current,
    /** Takes a PDF back that the import didn't keep; false (closed) once the dialog moved on. */
    giveBack: (pdf: PdfBook, request: number): boolean => {
      if (request !== pick.current) {
        closeQuietly(pdf);
        return false;
      }
      held.current = pdf;
      return true;
    }
  };
}

/** "Choose PDF…" (a file input) and the file's name. */
function BookFilePicker({
  opened,
  opening,
  onChoose
}: {
  opened: Opened | null;
  opening: boolean;
  onChoose: (file: File) => void;
}) {
  const inputId = useId();
  return (
    <div className="flex items-center gap-3">
      <label
        htmlFor={inputId}
        className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs text-fg-secondary transition-colors duration-micro ease-standard hover:bg-control hover:text-fg has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/70"
      >
        <FileText className="size-3.5" aria-hidden="true" />
        {opened ? "Choose another PDF…" : "Choose PDF…"}
        <input
          id={inputId}
          type="file"
          accept="application/pdf,.pdf"
          aria-label="Book PDF"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onChoose(file);
            event.target.value = "";
          }}
        />
      </label>
      <span className="min-w-0 truncate text-xs text-fg-muted" title={opened?.file.name}>
        {opening ? "Opening…" : (opened?.file.name ?? "No file chosen")}
      </span>
    </div>
  );
}

/** "$2.10 · about 50 min", or why there's no estimate yet. */
function estimateText(estimate: BookEstimate | undefined, failed: boolean): string {
  if (!estimate) return failed ? "Couldn't be estimated" : "…";
  const prices = estimate.prices === "fallback" ? " (prices not checked today)" : "";
  return `${formatUsd(estimate.costUsd)} · ${formatMinutes(estimate.minutes)}${prices}`;
}

/** The book's page count, what it will roughly cost and take, and the models that will read it. */
function BookFacts({
  pageCount,
  estimate,
  estimateFailed,
  fallbackModels,
  continuing
}: {
  pageCount: number;
  estimate: BookEstimate | undefined;
  estimateFailed: boolean;
  fallbackModels: [string, string] | null;
  continuing: boolean;
}) {
  const [ocrModel, structureModel] = estimate
    ? [estimate.ocrModel, estimate.structureModel]
    : (fallbackModels ?? ["…", "…"]);
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
      <dt className="text-fg-muted">Pages</dt>
      <dd className="text-fg tabular-nums">{pageCount.toLocaleString("en-US")}</dd>
      {continuing ? null : (
        <>
          <dt className="text-fg-muted">Expected cost</dt>
          <dd className="text-fg tabular-nums">{estimateText(estimate, estimateFailed)}</dd>
        </>
      )}
      <dt className="text-fg-muted">Reads the pages</dt>
      <dd className="truncate font-mono text-fg-secondary" title={ocrModel}>
        {ocrModel}
      </dd>
      <dt className="text-fg-muted">Builds the lines</dt>
      <dd className="truncate font-mono text-fg-secondary" title={structureModel}>
        {structureModel}
      </dd>
    </dl>
  );
}
