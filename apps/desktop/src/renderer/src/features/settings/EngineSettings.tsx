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
import {
  defaultEngineThreads,
  defaultSettings,
  type AppSettings
} from "@chaturanga/shared/types/settings";
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
import { Input, Select } from "@/components/ui/input";
import { OverflowMenu } from "@/components/ui/menu";
import { Notice } from "@/components/ui/notice";
import { SectionHeader } from "@/components/ui/page";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { hasDesktopApi } from "@/lib/environment";
import { engineListRows, maiaNeedsLc0, progressPercent } from "@/lib/engine-assets";
import { cardPadded, divider, fieldHint, listRow, well } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useSetSetting } from "./use-set-setting";
import { splitEngineArgs } from "@/lib/engine-args";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { isOneOf } from "@chaturanga/shared/types/guards";
import {
  EngineImagePreview,
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

const HASH_SIZE_OPTIONS_MB = [64, 128, 256, 512, 1024] as const;

/** Logical cores the renderer can see; main clamps `engineThreads` to its own `os.cpus()` count. */
function logicalCores(): number {
  const cores = typeof navigator === "undefined" ? 0 : navigator.hardwareConcurrency;
  return Number.isFinite(cores) && cores > 0 ? cores : 4;
}

function formatHashSize(mb: number): string {
  return mb >= 1024 && mb % 1024 === 0 ? `${mb / 1024} GB` : `${mb} MB`;
}

export function EnginePerformanceSettings({ appearance }: { appearance: AppSettings }) {
  const setSetting = useSetSetting();
  const cores = logicalCores();
  const autoThreads = defaultEngineThreads(cores);
  const threadOptions = Array.from({ length: cores }, (_, index) => index + 1);
  const hashOptions: number[] = isOneOf(HASH_SIZE_OPTIONS_MB, appearance.engineHashMb)
    ? [...HASH_SIZE_OPTIONS_MB]
    : [...HASH_SIZE_OPTIONS_MB, appearance.engineHashMb].sort((a, b) => a - b);
  return (
    <div className="grid gap-1">
      <SectionHeader
        as="h3"
        title="Performance"
        description="For the evaluation engine in Game review and live analysis."
      />
      <div className="grid divide-y divide-line-subtle">
        <SettingRow
          label="Threads"
          htmlFor="setting-engine-threads"
          description={`CPU cores the evaluation engine may use. Auto keeps one of your ${cores} free for the app.`}
          control={
            <Select
              id="setting-engine-threads"
              className="w-36"
              value={
                appearance.engineThreads === null
                  ? "auto"
                  : String(Math.min(appearance.engineThreads, cores))
              }
              onChange={(event) =>
                setSetting(
                  "engineThreads",
                  event.target.value === "auto" ? null : Number(event.target.value)
                )
              }
            >
              <option value="auto">Auto · {autoThreads}</option>
              {threadOptions.map((count) => (
                <option key={count} value={count}>
                  {count} {count === 1 ? "thread" : "threads"}
                </option>
              ))}
            </Select>
          }
        />
        <SettingRow
          label="Hash"
          htmlFor="setting-engine-hash"
          description={`Memory for the engine's position cache. More helps long searches. Default ${formatHashSize(defaultSettings.engineHashMb)}.`}
          control={
            <Select
              id="setting-engine-hash"
              className="w-36"
              value={appearance.engineHashMb}
              onChange={(event) => setSetting("engineHashMb", Number(event.target.value))}
            >
              {hashOptions.map((mb) => (
                <option key={mb} value={mb}>
                  {formatHashSize(mb)}
                </option>
              ))}
            </Select>
          }
        />
      </div>
    </div>
  );
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
  // Downloads join the list once their status is read; a failed read leaves just the engines.
  const loading = desktopApiAvailable && (engines.isPending || (!assets.status && !assets.error));
  const noEngines = !loading && engines.isSuccess && rows.length === 0;
  const statuses = assets.status ? Object.values(assets.status) : [];
  const checkError = statuses.find((entry) => entry.checkError)?.checkError ?? null;
  const lastChecked = latestCheckedAt(statuses);

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
              onClick={() => setAdding((value) => !value)}
            >
              <Plus />
              Add engine
            </Button>
          </>
        }
      />

      {adding ? (
        <div className={cn(well, "grid animate-rise-in gap-3 p-3")}>
          <p className="text-sm font-medium text-fg">New UCI engine</p>
          <EngineForm
            idPrefix="new-engine"
            draft={draft}
            onChange={(patch) => setDraft((value) => ({ ...value, ...patch }))}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void testDraft()}
              disabled={!desktopApiAvailable || !draft.executablePath.trim()}
            >
              <Play />
              Test
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => void addEngine()}
              disabled={
                !desktopApiAvailable || !draft.executablePath.trim() || createEngine.isPending
              }
            >
              Add engine
            </Button>
          </div>
        </div>
      ) : null}

      {maiaNeedsLc0(assets.status) ? (
        <Notice tone="warn" title="Maia needs Lc0">
          The Maia networks are installed, but Maia runs inside Lc0, which isn't set up yet. Install
          Lc0 (the command is below), then choose its binary from the Lc0 row's menu. Until then
          Maia isn't used in reviews and can't be played against.
        </Notice>
      ) : null}

      {loading ? (
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

      {noEngines && !adding ? (
        <EmptyState compact title="No engines yet. Add a UCI engine you already have." />
      ) : null}

      {!loading && rows.length ? (
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

      {desktopApiAvailable ? (
        <p className={fieldHint}>
          {checkError
            ? `Couldn't reach GitHub (${checkError}); showing the last known releases. `
            : null}
          {lastChecked ? `Releases checked ${lastChecked}. ` : null}
          Maia networks by{" "}
          <a
            href="https://github.com/CSSLab/maia-chess"
            target="_blank"
            rel="noopener noreferrer"
            className="text-info hover:underline"
          >
            CSSLab
          </a>{" "}
          (CC BY). Stockfish is GPL-3.0.
        </p>
      ) : null}

      <div className={divider} />
      <EnginePerformanceSettings appearance={appearance} />
    </section>
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
    updateEngine.mutate({ id: engine.id, patch }, { onSuccess: () => onEditingChange(false) });
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

  return (
    <div className="grid gap-1.5">
      <div className={cn(listRow, editing && "border-line-strong")}>
        <EngineImagePreview imagePath={engine.imagePath} name={engine.name} />
        <EngineRowText
          name={engine.name}
          detail={engine.executablePath}
          badges={
            <>
              {engine.isDefault ? <Badge tone="accent">Default</Badge> : null}
              {engine.isHumanPrediction ? <Badge tone="info">Maia</Badge> : null}
            </>
          }
        />
        <OverflowMenu
          label={`${engine.name} actions`}
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
        <Field label="Engine image" hint="optional" htmlFor={`${idPrefix}-image`}>
          <div className="flex gap-2">
            <EngineImagePreview imagePath={draft.imagePath} name={draft.name} size="md" />
            <Input
              id={`${idPrefix}-image`}
              value={draft.imagePath}
              onChange={(event) => onChange({ imagePath: event.target.value })}
              placeholder="PNG, JPG, WebP, GIF or SVG"
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
