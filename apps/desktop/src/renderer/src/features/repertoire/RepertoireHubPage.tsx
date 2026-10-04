import { useEffect, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  Copy,
  Download,
  GraduationCap,
  HardDrive,
  HardDriveDownload,
  HardDriveUpload,
  Library,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
  Upload
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  RepertoireColor,
  RepertoireListFilters,
  RepertoireSummary
} from "@chaturanga/shared/types/repertoire";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { OverflowMenu } from "@/components/ui/menu";
import { Notice } from "@/components/ui/notice";
import { Page, PageHeader } from "@/components/ui/page";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SideDot } from "@/components/ui/side-dot";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { hasDesktopApi } from "@/lib/environment";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { listRowInteractive } from "@/lib/ui";
import { cn } from "@/lib/utils";
import {
  repertoireKeys,
  useArchiveRepertoireMutation,
  useDuplicateRepertoireMutation,
  useExportRepertoireMutation,
  useRemoveChapterMutation,
  useRemoveRepertoireMutation,
  useRepertoireDueSummaryQuery,
  useRepertoiresQuery
} from "../../queries/repertoire";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import { formatBytes, restoreNotice, shortenPath } from "./backup";
import { discardDeletedRepertoireTexts } from "./decision-text-drafts";
import { BackupDialog } from "./BackupDialog";
import { CreateRepertoireDialog } from "./CreateRepertoireDialog";
import { EditRepertoireDialog } from "./EditRepertoireDialog";
import { ImportPgnDialog } from "./ImportPgnDialog";
import { RestoreBackupDialog } from "./RestoreBackupDialog";
import {
  COLOR_LABELS,
  mostDue,
  plural,
  relativeDay,
  resumePracticeTarget,
  sortedChapters,
  type ResumePracticeTarget,
  type StudyTarget
} from "./repertoire-chapters";

type ColorFilter = RepertoireColor | "all";

const colorOptions = [
  { value: "all" as const, label: "All" },
  { value: "white" as const, label: "White" },
  { value: "black" as const, label: "Black" }
];

/** Unfiltered, unarchived repertoires (the same list Home reads). */
const ACTIVE: RepertoireListFilters = {};

/**
 * The repertoire hub (§5.1): review what's due, create, filter and search repertoires, and act on
 * each one (study, practice, import/export PGN, back up, duplicate, archive, delete). Native backup
 * and restore live in the header's Backup menu (desktop only).
 */
export function RepertoireHubPage({
  onStudy,
  onPractice,
  onResume,
  onReview
}: {
  onStudy: (target: StudyTarget) => void;
  onPractice: (repertoireId: string) => void;
  /** The unfinished practice session (e.g. after a restart). */
  onResume: (target: ResumePracticeTarget) => void;
  /** Practice set up as a review of everything due. */
  onReview: (repertoireId: string) => void;
}) {
  const desktop = Boolean(window.chaturanga?.repertoires);
  // Backups go through main-owned native dialogs, so they're hidden outside the desktop app.
  const backups =
    desktop && hasDesktopApi() && Boolean(window.chaturanga?.repertoires.exportBackup);
  const queryClient = useQueryClient();
  const [color, setColor] = useState<ColorFilter>("all");
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  // "Last studied" is relative to when the hub opened (render stays pure).
  const [now] = useState(() => Date.now());
  const filters: RepertoireListFilters = { color, query: query.trim() || undefined, archived };
  const list = useRepertoiresQuery(filters);
  // Review targets everything due, whatever the hub is filtered to.
  const active = useRepertoiresQuery(ACTIVE);
  // An unsaved prompt or hint of a repertoire deleted since has nowhere to go: dropped here, so it
  // never holds back closing the window.
  useEffect(() => {
    if (active.data) {
      void discardDeletedRepertoireTexts(
        queryClient,
        active.data.map((item) => item.id)
      );
    }
  }, [active.data, queryClient]);
  const due = useRepertoireDueSummaryQuery();
  const duplicate = useDuplicateRepertoireMutation();
  const archive = useArchiveRepertoireMutation();
  const remove = useRemoveRepertoireMutation();
  const removeChapter = useRemoveChapterMutation();
  /** The empty first chapter of a repertoire created to import into; the import replaces it. */
  const [placeholder, setPlaceholder] = useState<{
    repertoireId: string;
    chapterId: string;
  } | null>(null);
  const exportMutation = useExportRepertoireMutation();
  const [creating, setCreating] = useState(false);
  const [importTarget, setImportTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<RepertoireSummary | null>(null);
  const [editing, setEditing] = useState<RepertoireSummary | null>(null);
  /** The backup dialog's scope: every repertoire, or one. */
  const [backupTarget, setBackupTarget] = useState<"all" | RepertoireSummary | null>(null);
  const [restoring, setRestoring] = useState(false);
  // The open study draft, so a restore that replaces its repertoire can ask before discarding it.
  const draftRepertoireId = useRepertoireWorkspaceStore((state) => state.repertoireId);
  const draftDirty = useRepertoireWorkspaceStore((state) => state.dirty);
  const [notice, setNotice] = useState<{
    tone: "danger" | "success" | "info";
    text: string;
    pgn?: string;
    /** Extra lines under the message (where replaced repertoires were backed up). */
    details?: string[];
    /** Full path behind a shortened one, as a tooltip. */
    path?: string;
    action?: { label: string; onSelect: () => void };
  } | null>(null);

  const items = list.data ?? [];
  const reviewTarget = mostDue(active.data ?? []);
  const continueTarget = due.data?.continue ?? null;
  const resume = resumePracticeTarget(due.data);

  const fail = (error: unknown, fallback: string) =>
    setNotice({ tone: "danger", text: ipcErrorMessage(error) || fallback });

  /** Study opens the last chapter studied, else the first one. */
  async function study(id: string) {
    const api = window.chaturanga?.repertoires;
    if (!api) return;
    try {
      const detail = await queryClient.fetchQuery({
        queryKey: repertoireKeys.detail(id),
        queryFn: () => api.get(id)
      });
      const last = detail.workspace?.lastChapterId;
      const chapter =
        detail.chapters.find((item) => item.id === last) ?? sortedChapters(detail.chapters)[0];
      if (!chapter) {
        setNotice({
          tone: "info",
          text: "This repertoire has no chapters yet. Import a PGN to add some."
        });
        return;
      }
      onStudy({
        repertoireId: id,
        chapterId: chapter.id,
        nodeId: chapter.id === last ? (detail.workspace?.lastNodeId ?? null) : null
      });
    } catch (error) {
      fail(error, "Couldn't open that repertoire.");
    }
  }

  function exportPgn(item: RepertoireSummary) {
    setNotice(null);
    exportMutation.mutate(
      { repertoireId: item.id },
      {
        onSuccess: (result) => {
          if (result.savedPath) {
            setNotice({
              tone: "success",
              text: `Exported ${plural(result.chapterCount, "chapter")} to ${result.savedPath}.`
            });
          } else if (result.pgn.trim()) {
            setNotice({ tone: "info", text: "The PGN wasn't saved to a file.", pgn: result.pgn });
          }
        },
        onError: (error) => fail(error, "Couldn't export the PGN.")
      }
    );
  }

  if (!desktop) {
    return (
      <Page>
        <PageHeader title="Repertoire" />
        <EmptyState
          icon={<Library />}
          title="Repertoires need the desktop app"
          description="Your repertoires, practice schedule and progress are stored by the app."
        />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Repertoire"
        description="Build the openings you play, then practise one decision at a time."
        actions={
          <>
            {backups ? (
              <OverflowMenu
                label="Backup"
                trigger={{ text: "Backup", icon: <HardDrive /> }}
                items={[
                  {
                    label: "Back up all repertoires…",
                    icon: <HardDriveDownload />,
                    onSelect: () => setBackupTarget("all")
                  },
                  {
                    label: "Restore from backup…",
                    icon: <HardDriveUpload />,
                    onSelect: () => setRestoring(true)
                  }
                ]}
              />
            ) : null}
            {continueTarget ? (
              <Button type="button" variant="ghost" onClick={() => onStudy(continueTarget)}>
                <BookOpen />
                Continue studying
              </Button>
            ) : null}
            {resume ? (
              <Button
                type="button"
                variant="outline"
                title={resume.description}
                onClick={() => onResume(resume)}
              >
                <Play />
                {resume.label}
              </Button>
            ) : null}
            {(due.data?.dueCount ?? 0) > 0 && reviewTarget ? (
              <>
                <Button type="button" variant="outline" onClick={() => setCreating(true)}>
                  <Plus />
                  Create repertoire
                </Button>
                <Button type="button" variant="primary" onClick={() => onReview(reviewTarget.id)}>
                  <GraduationCap />
                  Review due ({reviewTarget.dueCount})
                </Button>
              </>
            ) : (
              <Button type="button" variant="primary" onClick={() => setCreating(true)}>
                <Plus />
                Create repertoire
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          ariaLabel="Colour"
          size="sm"
          value={color}
          onChange={setColor}
          options={colorOptions}
        />
        <div className="relative min-w-48 flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
            aria-hidden="true"
          />
          <Input
            type="search"
            aria-label="Search repertoires"
            placeholder="Search by name or tag"
            className="pl-8"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-fg-secondary">
          <Switch
            checked={archived}
            onCheckedChange={setArchived}
            aria-label="Show archived repertoires"
          />
          Archived
        </label>
      </div>

      {notice ? (
        <Notice
          tone={notice.tone}
          action={
            <div className="flex gap-2">
              {notice.action ? (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => {
                    const action = notice.action!;
                    setNotice(null);
                    action.onSelect();
                  }}
                >
                  {notice.action.label}
                </Button>
              ) : null}
              {notice.pgn ? (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(notice.pgn!)
                      .then(() =>
                        setNotice({ tone: "success", text: "PGN copied to the clipboard." })
                      )
                      .catch(() => setNotice({ tone: "danger", text: "Couldn't copy the PGN." }))
                  }
                >
                  <Copy />
                  Copy PGN
                </Button>
              ) : null}
              <Button type="button" variant="link" size="xs" onClick={() => setNotice(null)}>
                Dismiss
              </Button>
            </div>
          }
        >
          <span title={notice.path}>{notice.text}</span>
          {notice.details?.length ? (
            <ul className="mt-1 grid gap-0.5 text-fg-muted">
              {notice.details.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </Notice>
      ) : null}

      {list.isPending ? (
        <div className="grid gap-2" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : list.isError ? (
        <Notice
          tone="danger"
          title="Couldn't load your repertoires"
          action={
            <Button type="button" variant="outline" size="xs" onClick={() => void list.refetch()}>
              Try again
            </Button>
          }
        >
          {ipcErrorMessage(list.error)}
        </Notice>
      ) : items.length ? (
        <ul className="grid gap-2" aria-label="Repertoires">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-2">
              <button
                type="button"
                className={cn(listRowInteractive, "flex-1")}
                onClick={() => void study(item.id)}
                aria-label={`Study ${item.name}`}
              >
                <SideDot color={item.color} size="md" />
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate font-medium text-fg">{item.name}</span>
                  <span className="truncate text-xs text-fg-muted">
                    {COLOR_LABELS[item.color]} · {plural(item.chapterCount, "chapter")} ·{" "}
                    {plural(item.decisionCount, "decision")} · Last studied{" "}
                    {relativeDay(item.lastStudiedAt, now).toLowerCase()}
                  </span>
                  {item.tags.length ? (
                    <span className="flex min-w-0 gap-1 overflow-hidden">
                      {item.tags.map((tag) => (
                        <Badge key={tag}>{tag}</Badge>
                      ))}
                    </span>
                  ) : null}
                </span>
                {item.archivedAt ? <Badge>Archived</Badge> : null}
                {item.dueCount ? (
                  <Badge tone="accent" size="md">
                    {item.dueCount} due
                  </Badge>
                ) : null}
              </button>
              <OverflowMenu
                label={`${item.name} actions`}
                items={[
                  { label: "Study", icon: <BookOpen />, onSelect: () => void study(item.id) },
                  ...(resume?.repertoireId === item.id
                    ? [
                        {
                          label: resume.label,
                          icon: <Play />,
                          onSelect: () => onResume(resume)
                        }
                      ]
                    : []),
                  {
                    label: "Practice",
                    icon: <GraduationCap />,
                    // The main process refuses practice on an archived repertoire.
                    disabled: Boolean(item.archivedAt),
                    onSelect: () => onPractice(item.id)
                  },
                  {
                    label: "Edit repertoire",
                    icon: <Pencil />,
                    onSelect: () => setEditing(item)
                  },
                  {
                    label: "Import PGN",
                    icon: <Upload />,
                    onSelect: () => setImportTarget(item.id)
                  },
                  { label: "Export PGN", icon: <Download />, onSelect: () => exportPgn(item) },
                  backups && {
                    label: "Back up this repertoire…",
                    icon: <HardDriveDownload />,
                    onSelect: () => setBackupTarget(item)
                  },
                  {
                    label: "Duplicate",
                    icon: <Copy />,
                    onSelect: () =>
                      duplicate.mutate(
                        { id: item.id },
                        {
                          onSuccess: (copy) =>
                            setNotice({ tone: "success", text: `Created “${copy.name}”.` }),
                          onError: (error) => fail(error, "Couldn't duplicate it.")
                        }
                      )
                  },
                  {
                    label: item.archivedAt ? "Unarchive" : "Archive",
                    icon: item.archivedAt ? <ArchiveRestore /> : <Archive />,
                    onSelect: () =>
                      archive.mutate(
                        {
                          id: item.id,
                          archived: !item.archivedAt,
                          expectedRevision: item.revision
                        },
                        { onError: (error) => fail(error, "Couldn't change it.") }
                      )
                  },
                  {
                    label: "Delete",
                    icon: <Trash2 />,
                    destructive: true,
                    onSelect: () => setDeleting(item)
                  }
                ]}
              />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={<Library />}
          title={
            archived
              ? "No archived repertoires"
              : query || color !== "all"
                ? "No repertoires match"
                : "No repertoires yet"
          }
          description={
            archived || query || color !== "all"
              ? undefined
              : "Start one for each side you play — for example “My 1.e4 repertoire” or “Black against 1.e4”."
          }
          action={
            archived || query || color !== "all" ? undefined : (
              <Button type="button" variant="primary" onClick={() => setCreating(true)}>
                <Plus />
                Create repertoire
              </Button>
            )
          }
        />
      )}

      {creating ? (
        <CreateRepertoireDialog
          onClose={() => setCreating(false)}
          onCreated={(detail, next) => {
            setCreating(false);
            const first = sortedChapters(detail.chapters)[0];
            if (next === "import") {
              setImportTarget(detail.id);
              setPlaceholder(first ? { repertoireId: detail.id, chapterId: first.id } : null);
            } else if (next === "study" && first) {
              onStudy({ repertoireId: detail.id, chapterId: first.id, nodeId: null });
            }
            // "add-game": the Add to repertoire dialog is open over the hub.
          }}
        />
      ) : null}
      {editing ? (
        <EditRepertoireDialog
          repertoire={editing}
          onClose={() => setEditing(null)}
          onSaved={(detail) => {
            setEditing(null);
            setNotice({ tone: "success", text: `Saved the details of “${detail.name}”.` });
          }}
        />
      ) : null}
      {importTarget ? (
        <ImportPgnDialog
          repertoireId={importTarget}
          onClose={() => {
            setImportTarget(null);
            setPlaceholder(null);
          }}
          onImported={(result) => {
            setImportTarget(null);
            setPlaceholder(null);
            const empty = result.repertoire.chapters.find(
              (chapter) =>
                chapter.id === placeholder?.chapterId &&
                result.repertoire.id === placeholder.repertoireId &&
                chapter.nodeCount === 0
            );
            if (empty && result.chaptersAdded > 0) {
              removeChapter.mutate({
                repertoireId: result.repertoire.id,
                chapterId: empty.id,
                expectedRevision: result.repertoire.revision
              });
            }
            setNotice({
              tone: "success",
              text: `Imported ${plural(result.chaptersAdded, "chapter")} into “${result.repertoire.name}”.`
            });
          }}
        />
      ) : null}
      {backupTarget ? (
        <BackupDialog
          repertoire={backupTarget === "all" ? undefined : backupTarget}
          onClose={() => setBackupTarget(null)}
          onSaved={(result) => {
            setBackupTarget(null);
            setNotice({
              tone: "success",
              text: `Backup saved (${plural(result.repertoireCount, "repertoire")}, ${formatBytes(result.bytes)}) to ${shortenPath(result.savedPath)}.`,
              details: result.warnings,
              path: result.savedPath
            });
          }}
        />
      ) : null}
      {restoring ? (
        <RestoreBackupDialog
          draft={{ repertoireId: draftRepertoireId, dirty: draftDirty }}
          onClose={() => setRestoring(false)}
          onRestored={(preview, input, result) => {
            setRestoring(false);
            // A replaced repertoire's open study draft describes content that no longer exists
            // (the dialog asked first when the draft had unsaved edits).
            const draft = useRepertoireWorkspaceStore.getState();
            const replaced = result.restored.some(
              (item) => item.mode === "replace" && item.repertoireId === draft.repertoireId
            );
            if (replaced) draft.reset();
            const message = restoreNotice(preview, input, result);
            const only = result.restored.length === 1 ? result.restored[0] : null;
            setNotice({
              tone: "success",
              text: message.text,
              details: message.details,
              action: only
                ? { label: "Open", onSelect: () => void study(only.repertoireId) }
                : undefined
            });
          }}
        />
      ) : null}
      {deleting ? (
        <Dialog
          size="sm"
          title={`Delete “${deleting.name}”?`}
          description="Its chapters, notes and practice history are deleted. Archive it instead to keep them."
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="ghost-destructive"
                size="sm"
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(
                    { id: deleting.id, expectedRevision: deleting.revision },
                    {
                      onSuccess: (_result, input) => {
                        setDeleting(null);
                        // Its draft (even an unsaved or failed one) has nowhere to be saved now.
                        const draft = useRepertoireWorkspaceStore.getState();
                        if (draft.repertoireId === input.id) draft.reset();
                      },
                      onError: (error) => {
                        setDeleting(null);
                        fail(error, "Couldn't delete it.");
                      }
                    }
                  )
                }
              >
                <Trash2 />
                Delete repertoire
              </Button>
            </>
          }
        />
      ) : null}
    </Page>
  );
}
