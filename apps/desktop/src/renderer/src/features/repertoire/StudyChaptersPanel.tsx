import { useState } from "react";
import { ArrowDown, ArrowUp, BookOpen, Pencil, Plus, Trash2 } from "lucide-react";
import type { ChapterKind, RepertoireChapterSummary } from "@chaturanga/shared/types/repertoire";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { OverflowMenu } from "@/components/ui/menu";
import { Switch } from "@/components/ui/switch";
import { listRow, listRowSelected } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { KIND_LABELS, plural, sortedChapters } from "./repertoire-chapters";

/**
 * The repertoire's chapters in study order: kind, enabled switch, due count; open by clicking the
 * title; rename inline; reorder, change kind and remove (with a confirmation) from the row menu.
 */
export function StudyChaptersPanel({
  chapters,
  currentChapterId,
  busy,
  onOpen,
  onRename,
  onSetEnabled,
  onSetKind,
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
  onMove: (chapterId: string, direction: -1 | 1) => void;
  onAdd: (title: string) => void;
  onRemove: (chapterId: string) => void;
}) {
  const ordered = sortedChapters(chapters);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [removing, setRemoving] = useState<RepertoireChapterSummary | null>(null);

  const commitRename = () => {
    if (renaming?.title.trim()) onRename(renaming.id, renaming.title.trim());
    setRenaming(null);
  };

  return (
    <div className="scroll-area -mr-3 grid h-full min-h-0 content-start gap-2 overflow-y-auto pr-3">
      <ul className="grid gap-1" aria-label="Chapters">
        {ordered.map((chapter, index) => {
          const current = chapter.id === currentChapterId;
          return (
            <li key={chapter.id} className={cn(listRow, "gap-2 px-2", current && listRowSelected)}>
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
                    {plural(Math.max(0, chapter.nodeCount - 1), "move")}
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
                  index > 0 && {
                    label: "Move up",
                    icon: <ArrowUp />,
                    disabled: busy,
                    onSelect: () => onMove(chapter.id, -1)
                  },
                  index < ordered.length - 1 && {
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

      {adding !== null ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
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
