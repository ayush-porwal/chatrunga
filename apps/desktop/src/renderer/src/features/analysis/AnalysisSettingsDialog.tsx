import { engineDisplayName } from "@chaturanga/shared/engine/managed";
import { useId, type ComponentProps, type ReactNode } from "react";
import {
  ANALYSIS_DEPTH_RANGE,
  ANALYSIS_PLAN_ARROWS,
  defaultSettings,
  type AnalysisLimit,
  type AppSettings,
  type EvalBarSide
} from "@chaturanga/shared/types/settings";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { SettingRow } from "@/components/ui/field";
import { Select } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { fieldHint } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useEnginesQuery, useSettingsQuery } from "../../queries/api";
import { ENGINE_PERFORMANCE_DESCRIPTION, EnginePerformanceRows } from "../settings/EngineSettings";
import { useSetSetting } from "../settings/use-set-setting";
import { analysisEngineFor } from "./analysis-engine";
import { EngineAvatar } from "./EngineAvatar";

const lineOptions = [1, 2, 3, 4, 5].map((count) => ({
  value: String(count),
  label: String(count)
}));

const limitOptions: readonly { value: AnalysisLimit; label: string }[] = [
  { value: "infinite", label: "Until stopped" },
  { value: "depth", label: "Depth" },
  { value: "time", label: "Time" }
];

const planOptions = ANALYSIS_PLAN_ARROWS.map((count) => ({
  value: String(count),
  label: count ? String(count) : "Off"
}));

const sideOptions: readonly { value: EvalBarSide; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "right", label: "Right" }
];

/** Seconds per position offered for a timed search (Lichess and Chess.com offer similar steps). */
const TIME_OPTIONS_SEC = [1, 2, 3, 5, 10, 15, 30, 60, 120, 300];

/** The selects in the rows: as tall as the segmented controls beside them, as wide as their text. */
const rowSelect = "h-8 w-auto text-[0.8125rem] border-line-strong";

/**
 * Live analysis settings, as Lichess and Chess.com offer them, in three groups of rows: Engine
 * (which engine, how many lines, how far to search: until stopped, a depth, or a time per
 * position), Board (best-move arrow, plan arrows, evaluation bar and its side) and Performance
 * (threads and memory). Changes apply at once: a running analysis restarts with them.
 */
export function AnalysisSettingsDialog({ onClose }: { onClose: () => void }) {
  const ids = useId();
  const settingsQuery = useSettingsQuery();
  const settings: AppSettings = { ...defaultSettings, ...settingsQuery.data };
  const engines = useEnginesQuery();
  const usable = (engines.data ?? []).filter((engine) => engine.isAvailable);
  const engineId = analysisEngineFor(engines.data, settings.analysisEngineId);
  const engine = usable.find((item) => item.id === engineId) ?? null;
  const setSetting = useSetSetting();
  const timeOptions = TIME_OPTIONS_SEC.includes(settings.analysisTimeSec)
    ? TIME_OPTIONS_SEC
    : [...TIME_OPTIONS_SEC, settings.analysisTimeSec].sort((a, b) => a - b);

  return (
    <Dialog
      title="Analysis settings"
      description="Changes apply right away; a running analysis restarts with them."
      size="sm"
      onClose={onClose}
      bodyClassName="grid gap-3.5"
      footer={
        <div className="-mx-5 -mb-5 flex flex-1 items-center justify-end gap-2 border-t border-line-subtle px-4 py-3">
          <Button type="button" variant="primary" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <Group title="Engine">
        <Row
          label="Engine"
          htmlFor={`${ids}-engine`}
          control={
            <div className="relative">
              {engine ? (
                <EngineAvatar
                  imagePath={engine.imagePath}
                  size="sm"
                  className="pointer-events-none absolute left-1 top-1/2 z-10 -translate-y-1/2"
                />
              ) : null}
              <Select
                id={`${ids}-engine`}
                className={cn(rowSelect, "max-w-60", engine && "pl-9")}
                value={engineId ?? ""}
                disabled={!usable.length}
                onChange={(event) => setSetting("analysisEngineId", event.target.value || null)}
              >
                {usable.length ? null : <option value="">No engine installed</option>}
                {usable.map((item) => (
                  <option key={item.id} value={item.id}>
                    {engineDisplayName(item.name)}
                    {item.isHumanPrediction ? " · human-like" : ""}
                  </option>
                ))}
              </Select>
            </div>
          }
        />
        <Row
          label="Lines"
          description="best moves shown at once"
          control={
            <SegmentedControl
              ariaLabel="Lines"
              size="sm"
              value={String(settings.analysisLines)}
              onChange={(value) => setSetting("analysisLines", Number(value))}
              options={lineOptions}
            />
          }
        />
        <Row
          label="Search"
          description="per position"
          control={
            <SegmentedControl
              ariaLabel="Search limit"
              size="sm"
              value={settings.analysisLimit}
              onChange={(value) => setSetting("analysisLimit", value)}
              options={limitOptions}
            />
          }
        >
          {settings.analysisLimit === "depth" ? (
            <label className="flex items-center gap-2.5 text-[0.71875rem] tabular-nums text-fg-subtle">
              {ANALYSIS_DEPTH_RANGE.min}
              <input
                type="range"
                aria-label="Depth"
                className="flex-1 cursor-pointer accent-accent"
                min={ANALYSIS_DEPTH_RANGE.min}
                max={ANALYSIS_DEPTH_RANGE.max}
                step={1}
                value={settings.analysisDepth}
                onChange={(event) =>
                  setSetting("analysisDepth", Number(event.target.value), { batch: true })
                }
              />
              {ANALYSIS_DEPTH_RANGE.max}
              <span className="min-w-6 text-right font-mono text-[0.8125rem] font-semibold text-accent-fg">
                {settings.analysisDepth}
              </span>
            </label>
          ) : settings.analysisLimit === "time" ? (
            <Select
              aria-label="Time per position"
              className={cn(rowSelect, "w-full")}
              value={settings.analysisTimeSec}
              onChange={(event) => setSetting("analysisTimeSec", Number(event.target.value))}
            >
              {timeOptions.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {seconds < 60 ? `${seconds} s` : `${seconds / 60} min`} per position
                </option>
              ))}
            </Select>
          ) : (
            <p className={fieldHint}>The engine keeps thinking until you stop it or move on.</p>
          )}
        </Row>
      </Group>

      <Group title="Board">
        <Row
          label="Best move arrow"
          htmlFor={`${ids}-arrow`}
          description="An arrow for the engine's top move while analysing."
          control={
            <Switch
              id={`${ids}-arrow`}
              checked={settings.analysisBestMoveArrow}
              onCheckedChange={(value) => setSetting("analysisBestMoveArrow", value)}
            />
          }
        />
        <Row
          label="Plan arrows"
          description="Numbered arrows for the next moves of the engine's idea."
          control={
            <SegmentedControl
              ariaLabel="Plan arrows"
              size="sm"
              value={String(settings.analysisPlanArrows)}
              onChange={(value) => {
                const count = ANALYSIS_PLAN_ARROWS.find((option) => String(option) === value);
                if (count !== undefined) setSetting("analysisPlanArrows", count);
              }}
              options={planOptions}
            />
          }
        />
        <Row
          label="Evaluation bar"
          htmlFor={`${ids}-bar`}
          description="Beside the board, here and in Game review."
          control={
            <Switch
              id={`${ids}-bar`}
              checked={settings.analysisEvalBar}
              onCheckedChange={(value) => setSetting("analysisEvalBar", value)}
            />
          }
        />
        <Row
          label="Bar position"
          className={settings.analysisEvalBar ? undefined : "opacity-60"}
          control={
            <SegmentedControl
              ariaLabel="Evaluation bar position"
              size="sm"
              value={settings.analysisEvalBarSide}
              onChange={(value) => setSetting("analysisEvalBarSide", value)}
              options={sideOptions}
            />
          }
        />
      </Group>

      <Group title={`Performance · ${ENGINE_PERFORMANCE_DESCRIPTION}`}>
        <EnginePerformanceRows appearance={settings} Row={Row} selectClassName={rowSelect} />
      </Group>
    </Dialog>
  );
}

/** A titled group of rows in one bordered box. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="px-1 pb-1.5 text-2xs text-fg-subtle">{title}</h3>
      <div className="grid divide-y divide-line-subtle rounded-[10px] border border-line bg-surface">
        {children}
      </div>
    </section>
  );
}

/**
 * One setting: its label (and hint) on the left, its control on the right, and anything that
 * belongs to it (the search's depth, time or note) underneath.
 */
function Row({
  label,
  description,
  control,
  htmlFor,
  className,
  children
}: ComponentProps<typeof SettingRow> & { children?: ReactNode }) {
  return (
    <div className={cn("grid gap-2 px-3 py-2", className)}>
      <div className="flex min-h-8 items-center gap-3">
        <div className="grid min-w-0 flex-1 gap-px">
          <label htmlFor={htmlFor} className="text-[0.84375rem] font-medium text-fg">
            {label}
          </label>
          {description ? <p className="text-xs text-fg-subtle">{description}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">{control}</div>
      </div>
      {children ? <div className="pb-1">{children}</div> : null}
    </div>
  );
}
