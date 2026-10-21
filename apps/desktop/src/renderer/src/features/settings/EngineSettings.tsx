import { engineDisplayName } from "@chaturanga/shared/engine/managed";
import { useState } from "react";
import {
  Download,
  File,
  FolderOpen,
  Image,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2
} from "lucide-react";
import type { ChaturangaApi, DialogFileFilter } from "@chaturanga/shared/ipc/chaturanga-api";
import type {
  CreateEngineInput,
  EngineConfig,
  UpdateEngineInput
} from "@chaturanga/shared/types/engine";
import type { AppSettings } from "@chaturanga/shared/types/settings";
import {
  useCreateEngineMutation,
  useDeleteEngineMutation,
  useEnginesQuery,
  useUpdateEngineMutation
} from "../../queries/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, SettingRow } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { OverflowMenu } from "@/components/ui/menu";
import { Notice } from "@/components/ui/notice";
import { SectionHeader } from "@/components/ui/page";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { hasDesktopApi } from "@/lib/environment";
import { engineListRows, progressPercent } from "@/lib/engine-assets";
import { cardPadded, divider, fieldHint, listRow, well } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { ENGINE_PERFORMANCE_DESCRIPTION, EnginePerformanceRows } from "./engine-performance";
import { splitEngineArgs } from "@/lib/engine-args";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { EngineAvatar } from "../analysis/EngineAvatar";
import {
  EngineRowActions,
  EngineRowText,
  formatTestResult,
  savedEngineMenuItems,
  testSavedEngine,
  type TestResult
} from "./engine-row";
import { latestCheckedAt, ManagedEngineRow } from "./ManagedEngineRow";
import { useEngineAssets } from "./use-engine-assets";

const nnWeightsDialogFilters: DialogFileFilter[] = [
  { name: "Network weights / models", extensions: ["pb", "gz", "onnx", "zip"] },
  { name: "All files", extensions: ["*"] }
];

const engineImageDialogFilters: DialogFileFilter[] = [
  { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg"] },
  { name: "All files", extensions: ["*"] }
];

type EngineDraft = {
  name: string;
  executablePath: string;
  weightsPath: string;
  imagePath: string;
  args: string;
  isHumanPrediction: boolean;
};

const emptyEngineDraft: EngineDraft = {
  name: "Stockfish",
  executablePath: "",
  weightsPath: "",
  imagePath: "",
  args: "",
  isHumanPrediction: false
};

function draftToInput(draft: EngineDraft): CreateEngineInput {
  const weights = draft.weightsPath.trim();
  const image = draft.imagePath.trim();
  return {
    name: draft.name,
    executablePath: draft.executablePath,
    ...(weights ? { weightsPath: weights } : {}),
    ...(image ? { imagePath: image } : {}),
    args: splitEngineArgs(draft.args),
    isHumanPrediction: draft.isHumanPrediction
  };
}

function EnginePerformanceSettings({ appearance }: { appearance: AppSettings }) {
  return (
    <div className="grid gap-1">
      <SectionHeader as="h3" title="Performance" description={ENGINE_PERFORMANCE_DESCRIPTION} />
      <div className="grid divide-y divide-line-subtle">
        <EnginePerformanceRows appearance={appearance} />
      </div>
    </div>
  );
}

type EngineAssets = ReturnType<typeof useEngineAssets>;

/** What the engine list shows: placeholders while it loads, the empty state, the rows, or nothing. */
type EngineListView = "loading" | "empty" | "rows" | "none";

function engineListView({
  desktopApiAvailable,
  engines,
  assets,
  rowCount
}: {
  desktopApiAvailable: boolean;
  engines: { isPending: boolean; isSuccess: boolean };
  assets: Pick<EngineAssets, "status" | "error">;
  rowCount: number;
}): EngineListView {
  // Downloads join the list once their status is read; a failed read leaves just the engines.
  const loading = desktopApiAvailable && (engines.isPending || (!assets.status && !assets.error));
  if (loading) return "loading";
  if (rowCount) return "rows";
  return engines.isSuccess ? "empty" : "none";
}

export function EnginesSection({ appearance }: { appearance: AppSettings }) {
  const engines = useEnginesQuery();
  const createEngine = useCreateEngineMutation();
  const deleteEngine = useDeleteEngineMutation();
  const assets = useEngineAssets();
  const desktopApiAvailable = hasDesktopApi();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<EngineDraft>(emptyEngineDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult>(null);
  const engineList = engines.data ?? [];
  const rows = engineListRows(assets.status, engineList);
  const view = engineListView({ desktopApiAvailable, engines, assets, rowCount: rows.length });

  async function addEngine() {
    if (!desktopApiAvailable) return;
    try {
      const engine = await createEngine.mutateAsync(draftToInput(draft));
      setDraft(emptyEngineDraft);
      setAdding(false);
      setTestResult({ ok: true, message: `Added ${engine.name}.` });
    } catch (error) {
      setTestResult({
        ok: false,
        message: `Couldn't add the engine: ${ipcErrorMessage(error) || "unknown error"}`
      });
    }
  }

  async function testDraft() {
    if (!window.chaturanga) return;
    try {
      const result = await window.chaturanga.engines.test(draftToInput(draft));
      if (result.ok && result.isHumanPrediction)
        setDraft((value) => ({ ...value, isHumanPrediction: true }));
      setTestResult(formatTestResult(result, "UCI engine"));
    } catch (error) {
      setTestResult({ ok: false, message: ipcErrorMessage(error) || "The engine test failed." });
    }
  }

  return (
    <section className={cn(cardPadded, "grid gap-3")}>
      <SectionHeader
        title="Engines"
        description="Engines for analysis, review and engine games. Downloaded ones stay up to date when you ask."
        actions={
          <EnginesSectionActions
            assets={assets}
            adding={adding}
            onToggleAdding={() => setAdding((value) => !value)}
          />
        }
      />

      {adding ? (
        <NewEnginePanel
          draft={draft}
          onChange={(patch) => setDraft((value) => ({ ...value, ...patch }))}
          pending={createEngine.isPending}
          onCancel={() => setAdding(false)}
          onTest={() => void testDraft()}
          onAdd={() => void addEngine()}
        />
      ) : null}

      {view === "loading" ? (
        <div className="grid gap-1.5" aria-busy="true" aria-label="Loading engines">
          {[0, 1, 2].map((index) => (
            <div key={index} className={listRow}>
              <Skeleton as="span" className="size-8 shrink-0 rounded-lg" />
              <span className="grid flex-1 gap-1.5">
                <Skeleton as="span" className="h-3 w-28 rounded" />
                <Skeleton as="span" className="h-2.5 w-56 max-w-full rounded bg-control/70" />
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {engines.isError ? (
        <Notice
          tone="danger"
          action={
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => void engines.refetch()}
            >
              Try again
            </Button>
          }
        >
          {`Couldn't load your engines: ${ipcErrorMessage(engines.error) || "unknown error"}`}
        </Notice>
      ) : null}

      {view === "empty" && !adding ? (
        <EmptyState compact title="No engines yet. Add a UCI engine you already have." />
      ) : null}

      {view === "rows" ? (
        <div className="grid gap-1.5">
          {rows.map((row) =>
            row.kind === "asset" ? (
              <ManagedEngineRow
                key={row.id}
                row={row}
                busy={assets.busy[row.id] ?? false}
                percent={progressPercent(assets.progress[row.id])}
                onDownload={() => void assets.install(row.id, "download")}
                onUpdate={() => void assets.install(row.id, "update")}
                onRemove={() => void assets.remove(row.id)}
                onPickFile={() => void assets.pickCustomFile(row.id)}
                onResult={setTestResult}
              />
            ) : (
              <SavedEngineRow
                engine={row.engine}
                key={`${row.engine.id}-${row.engine.updatedAt}`}
                editing={editingId === row.engine.id}
                onEditingChange={(editing) => setEditingId(editing ? row.engine.id : null)}
                onDelete={() => deleteEngine.mutate(row.engine.id)}
                onResult={setTestResult}
              />
            )
          )}
        </div>
      ) : null}

      {testResult ? (
        <Notice
          key={testResult.message}
          className="animate-rise-in"
          tone={testResult.ok ? "success" : "danger"}
          action={
            <Button type="button" variant="link" size="xs" onClick={() => setTestResult(null)}>
              Dismiss
            </Button>
          }
        >
          {testResult.message}
        </Notice>
      ) : null}

      {assets.error ? <Notice tone="danger">{assets.error}</Notice> : null}

      {desktopApiAvailable ? <EngineSourcesNote status={assets.status} /> : null}

      <div className={divider} />
      <EnginePerformanceSettings appearance={appearance} />
    </section>
  );
}

/** The section's header buttons: Check for updates, Download missing, Add engine. */
function EnginesSectionActions({
  assets,
  adding,
  onToggleAdding
}: {
  assets: EngineAssets;
  adding: boolean;
  onToggleAdding: () => void;
}) {
  const desktopApiAvailable = hasDesktopApi();
  return (
    <>
      {desktopApiAvailable ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void assets.checkForUpdates()}
          disabled={assets.checking || !assets.status}
        >
          <RefreshCw className={cn(assets.checking && "animate-spin")} />
          {assets.checking ? "Checking…" : "Check for updates"}
        </Button>
      ) : null}
      {assets.missing.length > 0 ? (
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => void assets.downloadMissing()}
        >
          <Download />
          Download missing ({assets.missing.length})
        </Button>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={adding}
        disabled={!desktopApiAvailable}
        onClick={onToggleAdding}
      >
        <Plus />
        Add engine
      </Button>
    </>
  );
}

/** The form for a new UCI engine, with Cancel, Test and Add engine. */
function NewEnginePanel({
  draft,
  onChange,
  pending,
  onCancel,
  onTest,
  onAdd
}: {
  draft: EngineDraft;
  onChange: (patch: Partial<EngineDraft>) => void;
  /** The engine is being added. */
  pending: boolean;
  onCancel: () => void;
  onTest: () => void;
  onAdd: () => void;
}) {
  const desktopApiAvailable = hasDesktopApi();
  return (
    <div className={cn(well, "grid animate-rise-in gap-3 p-3")}>
      <p className="text-sm font-medium text-fg">New UCI engine</p>
      <EngineForm idPrefix="new-engine" draft={draft} onChange={onChange} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onTest}
          disabled={!desktopApiAvailable || !draft.executablePath.trim()}
        >
          <Play />
          Test
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={onAdd}
          disabled={!desktopApiAvailable || !draft.executablePath.trim() || pending}
        >
          Add engine
        </Button>
      </div>
    </div>
  );
}

/** When the releases were last checked (or why GitHub couldn't be reached), and the credits. */
function EngineSourcesNote({ status }: { status: EngineAssets["status"] }) {
  const statuses = status ? Object.values(status) : [];
  const checkError = statuses.find((entry) => entry.checkError)?.checkError ?? null;
  const lastChecked = latestCheckedAt(statuses);
  return (
    <p className={fieldHint}>
      {checkError
        ? `Couldn't reach GitHub (${checkError}); showing the last known releases. `
        : null}
      {lastChecked ? `Releases checked ${lastChecked}. ` : null}
      Stockfish, Lc0 and Maia 3 (by{" "}
      <a
        href="https://github.com/CSSLab/maia-platform-frontend"
        target="_blank"
        rel="noopener noreferrer"
        className="text-info hover:underline"
      >
        CSSLab
      </a>
      ) are GPL-3.0.
    </p>
  );
}

/** An engine the user added: Set as default, Test, Edit (inline form) and Delete. */
function SavedEngineRow({
  engine,
  editing,
  onEditingChange,
  onDelete,
  onResult
}: {
  engine: EngineConfig;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onDelete: () => void;
  onResult: (result: TestResult) => void;
}) {
  const updateEngine = useUpdateEngineMutation();
  const desktopApiAvailable = hasDesktopApi();
  const initialDraft: EngineDraft = {
    name: engine.name,
    executablePath: engine.executablePath,
    weightsPath: engine.weightsPath ?? "",
    imagePath: engine.imagePath ?? "",
    args: engine.args.join(" "),
    isHumanPrediction: engine.isHumanPrediction ?? false
  };
  const [draft, setDraft] = useState<EngineDraft>(initialDraft);

  function save() {
    if (!desktopApiAvailable) return;
    const patch: UpdateEngineInput = {
      name: draft.name.trim() || "UCI Engine",
      executablePath: draft.executablePath.trim(),
      weightsPath: draft.weightsPath.trim() || null,
      imagePath: draft.imagePath.trim() || null,
      args: splitEngineArgs(draft.args),
      isHumanPrediction: draft.isHumanPrediction
    };
    updateEngine.mutate(
      { id: engine.id, patch },
      {
        onSuccess: () => onEditingChange(false),
        // e.g. a picture that can't be copied: the editor stays open to fix it.
        onError: (error) =>
          onResult({
            ok: false,
            message: `Couldn't save the engine: ${ipcErrorMessage(error) || "unknown error"}`
          })
      }
    );
  }

  async function test() {
    const outcome = await testSavedEngine(engine);
    if (!outcome) return;
    if (outcome.maiaDetected) setDraft((value) => ({ ...value, isHumanPrediction: true }));
    onResult(outcome.result);
  }

  function cancel() {
    setDraft(initialDraft);
    onEditingChange(false);
  }

  // A row the app no longer manages (its download went away) never shows its "(managed)" marker.
  const shownName = engineDisplayName(engine.name);

  return (
    <div className="grid gap-1.5">
      <div className={cn(listRow, editing && "border-line-strong")}>
        <EngineAvatar engine={engine} size="md" label={`${shownName} engine image`} />
        <EngineRowText
          name={shownName}
          detail={engine.executablePath}
          badges={
            <>
              {engine.isDefault ? <Badge tone="accent">Default</Badge> : null}
              {engine.isHumanPrediction ? <Badge tone="info">Maia</Badge> : null}
            </>
          }
        />
        <EngineRowActions
          menu={
            <OverflowMenu
              label={`${shownName} actions`}
              items={[
                ...savedEngineMenuItems({
                  engine,
                  disabled: !desktopApiAvailable,
                  onSetDefault: () =>
                    updateEngine.mutate({ id: engine.id, patch: { isDefault: true } }),
                  onTest: () => void test()
                }),
                {
                  label: editing ? "Close editor" : "Edit",
                  icon: <Pencil />,
                  onSelect: () => (editing ? cancel() : onEditingChange(true))
                },
                {
                  label: "Delete",
                  icon: <Trash2 />,
                  onSelect: onDelete,
                  disabled: !desktopApiAvailable,
                  destructive: true
                }
              ]}
            />
          }
        />
      </div>
      {editing ? (
        <div className={cn(well, "grid animate-rise-in gap-3 p-3")}>
          <EngineForm
            idPrefix={`engine-${engine.id}`}
            draft={draft}
            onChange={(patch) => setDraft((value) => ({ ...value, ...patch }))}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={cancel}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={save}
              disabled={
                !desktopApiAvailable || !draft.executablePath.trim() || updateEngine.isPending
              }
            >
              Save changes
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Shared add/edit form for a UCI engine. */
function EngineForm({
  idPrefix,
  draft,
  onChange
}: {
  idPrefix: string;
  draft: EngineDraft;
  onChange: (patch: Partial<EngineDraft>) => void;
}) {
  const desktopApiAvailable = hasDesktopApi();

  /** Opens a native file dialog; a cancelled or failed one leaves the form as it was. */
  function pick(
    open: (files: ChaturangaApi["files"]) => Promise<string | null>,
    apply: (path: string) => void
  ) {
    const files = window.chaturanga?.files;
    if (!files) return;
    open(files).then(
      (selected) => {
        if (selected) apply(selected);
      },
      (error: unknown) => console.warn("file dialog failed", error)
    );
  }
  const pickExecutable = () =>
    pick(
      (files) => files.selectExecutable(),
      (path) => onChange({ executablePath: path })
    );
  const pickWeightsFile = () =>
    pick(
      (files) => files.selectOpenFile(nnWeightsDialogFilters),
      (path) => onChange({ weightsPath: path })
    );
  const pickImage = () =>
    pick(
      (files) => files.selectOpenFile(engineImageDialogFilters),
      (path) => onChange({ imagePath: path })
    );

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor={`${idPrefix}-name`}>
          <Input
            id={`${idPrefix}-name`}
            value={draft.name}
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </Field>
        <Field label="Executable" hint="starts in its own folder" htmlFor={`${idPrefix}-path`}>
          <div className="flex gap-2">
            <Input
              id={`${idPrefix}-path`}
              value={draft.executablePath}
              onChange={(event) => onChange({ executablePath: event.target.value })}
            />
            <IconButton
              label="Choose executable"
              icon={<FolderOpen />}
              variant="outline"
              size="icon"
              onClick={pickExecutable}
              disabled={!desktopApiAvailable}
            />
          </div>
        </Field>
        <Field label="Weights file" hint="Lc0 network · optional" htmlFor={`${idPrefix}-weights`}>
          <div className="flex gap-2">
            <Input
              id={`${idPrefix}-weights`}
              value={draft.weightsPath}
              onChange={(event) => onChange({ weightsPath: event.target.value })}
              placeholder="e.g. network.pb.gz"
            />
            <IconButton
              label="Choose weights file"
              icon={<File />}
              variant="outline"
              size="icon"
              onClick={pickWeightsFile}
              disabled={!desktopApiAvailable}
            />
          </div>
        </Field>
        <Field
          label="Engine image"
          hint="optional · copied into the app"
          htmlFor={`${idPrefix}-image`}
        >
          <div className="flex gap-2">
            <EngineAvatar engine={draft} size="md" label={`${draft.name} engine image`} />
            <Input
              id={`${idPrefix}-image`}
              value={draft.imagePath}
              onChange={(event) => onChange({ imagePath: event.target.value })}
              placeholder="PNG, JPG, WebP, GIF or SVG file (no web links)"
            />
            <IconButton
              label="Choose image"
              icon={<Image />}
              variant="outline"
              size="icon"
              onClick={pickImage}
              disabled={!desktopApiAvailable}
            />
          </div>
        </Field>
      </div>
      <Field
        label="Arguments"
        hint="weights file above overrides --weights"
        htmlFor={`${idPrefix}-args`}
      >
        <Input
          id={`${idPrefix}-args`}
          value={draft.args}
          onChange={(event) => onChange({ args: event.target.value })}
          placeholder="Extra flags"
        />
      </Field>
      <SettingRow
        label="Human prediction engine (Maia)"
        htmlFor={`${idPrefix}-maia`}
        control={
          <Switch
            id={`${idPrefix}-maia`}
            checked={draft.isHumanPrediction}
            onCheckedChange={(value) => onChange({ isHumanPrediction: value })}
          />
        }
      />
    </div>
  );
}
