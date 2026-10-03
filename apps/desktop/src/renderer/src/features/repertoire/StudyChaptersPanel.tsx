import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  GraduationCap,
  Pencil,
  Plus,
  Search,
  Trash2,
  X
} from "lucide-react";
import type { ChapterKind, RepertoireChapterSummary } from "@chaturanga/shared/types/repertoire";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { OverflowMenu } from "@/components/ui/menu";
import { Switch } from "@/components/ui/switch";
import { listRow, listRowSelected } from "@/lib/ui";
import { cn } from "@/lib/utils";
import {
  chaptersToChange,
  existingSelection,
  filterChapters,
  selectionState,
  windowedRows,
  withSelection,
  type ChapterBulkPatch
} from "./long-lists";
import { KIND_LABELS, plural, sortedChapters } from "./repertoire-chapters";

/** A chapter row's height, and the distance from one row's top to the next (rows don't vary). */
const ROW_HEIGHT = 56;
const ROW_STRIDE = 60;

/**
 * The repertoire's chapters in study order: kind, enabled switch, due count; open by clicking the
 * title; rename inline; reorder, change kind and remove (with a confirmation) from the row menu.
 * A search narrows the list by title; checked chapters (kept while the search changes) are
 * enabled, disabled or given a kind together through `onSetMany`. Only the rows in view are
 * mounted (plus the open chapter's and the one holding focus), so a collection imported as
 * hundreds of chapters stays quick to open and to filter.
 */
export function StudyChaptersPanel({
  chapters,
  currentChapterId,
  busy,
  onOpen,
  onRename,
  onSetEnabled,
  onSetKind,
  onSetMany,
  onMove,
  onAdd,
  onRemove
}: {
  chapters: readonly RepertoireChapterSummary[];
  currentChapterId: string;
  busy: boolean;
  onOpen: (chapterId: string) => void;
  onRename: (chapterId: string, title: string) => void;
  onSetEnabled: (chapterId: string, enabled: boolean) => void;
  onSetKind: (chapterId: string, kind: ChapterKind) => void;
  /** One write for several chapters (only those the patch changes are named). */
  onSetMany: (chapterIds: string[], patch: ChapterBulkPatch) => void;
  onMove: (chapterId: string, direction: -1 | 1) => void;
  onAdd: (title: string) => void;
  onRemove: (chapterId: string) => void;
}) {
  const ordered = useMemo(() => sortedChapters(chapters), [chapters]);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [removing, setRemoving] = useState<RepertoireChapterSummary | null>(null);
  const [query, setQuery] = useState("");
  const shown = useMemo(() => filterChapters(ordered, query), [ordered, query]);
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());
  // A removed chapter drops out of the selection.
  const selected = useMemo(
    () =>
      existingSelection(
        checked,
        ordered.map((chapter) => chapter.id)
      ),
    [checked, ordered]
  );
  const shownIds = useMemo(() => shown.map((chapter) => chapter.id), [shown]);
  const shownSelection = selectionState(selected, shownIds);
  const selectedShown = shownIds.filter((id) => selected.has(id)).length;
  /** The row holding keyboard focus (kept mounted while it is scrolled away). */
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const scroller = useRef<HTMLDivElement | null>(null);
  const list = useRef<HTMLUListElement | null>(null);
  /** The scroller's visible span, measured from the top of the list. */
  const [viewport, setViewport] = useState({ top: 0, height: 800 });
  const measure = useCallback(() => {
    const box = scroller.current;
    const rows = list.current;
    if (!box || !rows) return;
    const top = box.getBoundingClientRect().top - rows.getBoundingClientRect().top;
    setViewport((current) =>
      current.top === top && current.height === box.clientHeight
        ? current
        : { top, height: box.clientHeight }
    );
  }, []);
  useLayoutEffect(() => {
    measure();
    const box = scroller.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [measure]);
  // A search that shortens the list can pull the scroll position back without a scroll event.
  useLayoutEffect(measure, [measure, shown]);
  // Opening the panel shows the open chapter, however far down the list it is.
  const currentIndex = shown.findIndex((chapter) => chapter.id === currentChapterId);
  const initialIndex = useRef(currentIndex);
  useLayoutEffect(() => {
    const box = scroller.current;
    const index = initialIndex.current;
    if (!box || index < 0) return;
    const top = index * ROW_STRIDE;
    if (top + ROW_HEIGHT > box.clientHeight) box.scrollTop = top - box.clientHeight / 2;
  }, []);
  const rows = windowedRows({
    count: shown.length,
    rowHeight: ROW_STRIDE,
    viewport,
    pinned: [currentIndex, shown.findIndex((chapter) => chapter.id === focusedId)]
  });

  const commitRename = () => {
    if (renaming?.title.trim()) onRename(renaming.id, renaming.title.trim());
    setRenaming(null);
  };

  /** The selected chapters `patch` would change, written together. */
  const setMany = (patch: ChapterBulkPatch) => {
    const ids = chaptersToChange(ordered, selected, patch);
    if (ids.length) onSetMany(ids, patch);
  };
  const canSetMany = (patch: ChapterBulkPatch) =>
    !busy && chaptersToChange(ordered, selected, patch).length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {ordered.length > 1 ? (
        <div className="grid gap-1">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
              aria-hidden="true"
            />
            <Input
              type="search"
              aria-label="Search chapters"
              placeholder="Search chapters"
              className="h-8 pl-8"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="flex min-h-9 items-center gap-2 pl-2">
            <input
              type="checkbox"
              className="size-4 accent-accent"
              aria-label={query.trim() ? "Select the chapters found" : "Select all chapters"}
              checked={shownSelection === "all"}
              ref={(element) => {
                if (element) element.indeterminate = shownSelection === "some";
              }}
              disabled={!shown.length}
              onChange={(event) =>
                setChecked(withSelection(selected, shownIds, event.target.checked))
              }
            />
            <p className="min-w-0 flex-1 truncate text-2xs text-fg-subtle" aria-live="polite">
              {selected.size
                ? `${selected.size} selected${selected.size > selectedShown ? ` · ${selected.size - selectedShown} not shown` : ""}`
                : query.trim()
                  ? `${shown.length} of ${plural(ordered.length, "chapter")}`
                  : plural(ordered.length, "chapter")}
            </p>
            {selected.size ? (
              <OverflowMenu
                label="Selected chapters actions"
                items={[
                  {
                    label: "Enable for practice",
                    icon: <GraduationCap />,
                    disabled: !canSetMany({ enabled: true }),
                    onSelect: () => setMany({ enabled: true })
                  },
                  {
                    label: "Disable for practice",
                    icon: <GraduationCap />,
                    disabled: !canSetMany({ enabled: false }),
                    onSelect: () => setMany({ enabled: false })
                  },
                  {
                    label: "Make opening chapters",
                    icon: <BookOpen />,
                    disabled: !canSetMany({ kind: "opening" }),
                    onSelect: () => setMany({ kind: "opening" })
                  },
                  {
                    label: "Make reference chapters",
                    icon: <BookOpen />,
                    disabled: !canSetMany({ kind: "reference" }),
                    onSelect: () => setMany({ kind: "reference" })
                  },
                  {
                    label: "Clear selection",
                    icon: <X />,
                    onSelect: () => setChecked(new Set())
                  }
                ]}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        ref={scroller}
        onScroll={measure}
        className="scroll-area -mr-3 grid min-h-0 flex-1 content-start gap-2 overflow-y-auto pr-3"
      >
        <ul
          ref={list}
          className="relative"
          style={{ height: Math.max(shown.length * ROW_STRIDE - (ROW_STRIDE - ROW_HEIGHT), 0) }}
          aria-label="Chapters"
        >
          {rows.map((index) => {
            const chapter = shown[index];
            const position = ordered.indexOf(chapter);
            const current = chapter.id === currentChapterId;
            return (
              <li
                key={chapter.id}
                aria-posinset={index + 1}
                aria-setsize={shown.length}
                className={cn(listRow, "absolute inset-x-0 gap-2 px-2", current && listRowSelected)}
                style={{ top: index * ROW_STRIDE, height: ROW_HEIGHT }}
                onFocus={() => setFocusedId(chapter.id)}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setFocusedId((id) => (id === chapter.id ? null : id));
                  }
                }}
              >
                {ordered.length > 1 ? (
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-accent"
                    aria-label={`Select ${chapter.title}`}
                    checked={selected.has(chapter.id)}
                    onChange={(event) =>
                      setChecked(withSelection(selected, [chapter.id], event.target.checked))
                    }
                  />
                ) : null}
                {renaming?.id === chapter.id ? (
                  <Input
                    autoFocus
                    aria-label="Chapter title"
                    className="h-8"
                    value={renaming.title}
                    onChange={(event) => setRenaming({ id: chapter.id, title: event.target.value })}
                    onBlur={commitRename}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") commitRename();
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setRenaming(null);
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="grid min-w-0 flex-1 gap-0.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                    aria-current={current ? "true" : undefined}
                    onClick={() => onOpen(chapter.id)}
                    onDoubleClick={() => setRenaming({ id: chapter.id, title: chapter.title })}
                  >
                    <span className="truncate text-sm font-medium text-fg">{chapter.title}</span>
                    <span className="truncate text-2xs text-fg-subtle">
                      {plural(chapter.nodeCount, "move")}
                      {chapter.dueCount ? ` · ${chapter.dueCount} due` : ""}
                    </span>
                  </button>
                )}
                <Badge tone={chapter.kind === "reference" ? "neutral" : "info"}>
                  {chapter.kind === "reference" ? <BookOpen aria-hidden="true" /> : null}
                  {KIND_LABELS[chapter.kind]}
                </Badge>
                <Switch
                  checked={chapter.enabled}
                  disabled={busy}
                  aria-label={`${chapter.enabled ? "Disable" : "Enable"} ${chapter.title} for practice`}
                  title={chapter.enabled ? "Enabled for practice" : "Disabled for practice"}
                  onCheckedChange={(enabled) => onSetEnabled(chapter.id, enabled)}
                />
                <OverflowMenu
                  label={`${chapter.title} actions`}
                  items={[
                    {
                      label: "Rename",
                      icon: <Pencil />,
                      onSelect: () => setRenaming({ id: chapter.id, title: chapter.title })
                    },
                    {
                      label:
                        chapter.kind === "opening"
                          ? "Make reference chapter"
                          : "Make opening chapter",
                      icon: <BookOpen />,
                      disabled: busy,
                      onSelect: () =>
                        onSetKind(chapter.id, chapter.kind === "opening" ? "reference" : "opening")
                    },
                    position > 0 && {
                      label: "Move up",
                      icon: <ArrowUp />,
                      disabled: busy,
                      onSelect: () => onMove(chapter.id, -1)
                    },
                    position < ordered.length - 1 && {
                      label: "Move down",
                      icon: <ArrowDown />,
                      disabled: busy,
                      onSelect: () => onMove(chapter.id, 1)
                    },
                    ordered.length > 1 && {
                      label: "Remove chapter",
                      icon: <Trash2 />,
                      destructive: true,
                      disabled: busy,
                      onSelect: () => setRemoving(chapter)
                    }
                  ]}
                />
              </li>
            );
          })}
        </ul>
        {!shown.length && query.trim() ? (
          <p className="px-2 text-xs text-fg-muted">No chapters match “{query.trim()}”.</p>
        ) : null}

        {adding !== null ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              // Enter submits even while the button is disabled; a write in flight finishes first.
              if (busy) return;
              if (adding.trim()) onAdd(adding.trim());
              setAdding(null);
            }}
          >
            <Input
              autoFocus
              aria-label="New chapter title"
              placeholder="e.g. Italian Game"
              value={adding}
              onChange={(event) => setAdding(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setAdding(null);
                }
              }}
            />
            <Button type="submit" size="sm" variant="primary" disabled={!adding.trim() || busy}>
              Add
            </Button>
          </form>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="justify-self-start"
            disabled={busy}
            onClick={() => setAdding("")}
          >
            <Plus />
            Add chapter
          </Button>
        )}
      </div>

      {removing ? (
        <Dialog
          size="sm"
          title={`Remove “${removing.title}”?`}
          description="Its moves and notes are deleted. Decisions only this chapter supports stop being practised."
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
                  onRemove(removing.id);
                  setRemoving(null);
                }}
              >
                <Trash2 />
                Remove chapter
              </Button>
            </>
          }
        />
      ) : null}
    </div>
  );
}
