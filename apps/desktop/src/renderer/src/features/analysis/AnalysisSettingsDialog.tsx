import { engineDisplayName } from "@chaturanga/shared/engine/managed";
import { useId } from "react";
import {
  ANALYSIS_DEPTH_RANGE,
  defaultSettings,
  type AnalysisLimit,
  type AppSettings
} from "@chaturanga/shared/types/settings";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SettingsGroup, SettingsGroupRow, settingsRowSelect } from "@/components/ui/settings-group";
import { fieldHint } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useEnginesQuery, useSettingsQuery } from "../../queries/api";
import { BoardSettingsGroup } from "../board/BoardSettingsGroup";
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

/** Seconds per position offered for a timed search (Lichess and Chess.com offer similar steps). */
const TIME_OPTIONS_SEC = [1, 2, 3, 5, 10, 15, 30, 60, 120, 300];

/**
 * Live analysis settings, as Lichess and Chess.com offer them, in three groups of rows: Engine
 * (which engine, how many lines, how far to search: until stopped, a depth, or a time per
 * position), Board (the engine arrows and the evaluation bar, shared with Review settings) and
 * Performance (threads and memory). Changes apply at once: a running analysis restarts with them.
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
      <SettingsGroup title="Engine">
        <SettingsGroupRow
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
                className={cn(settingsRowSelect, "max-w-60", engine && "pl-9")}
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
        <SettingsGroupRow
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
        <SettingsGroupRow
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
              className={cn(settingsRowSelect, "w-full")}
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
        </SettingsGroupRow>
      </SettingsGroup>

      <BoardSettingsGroup settings={settings} />

      <SettingsGroup title={`Performance · ${ENGINE_PERFORMANCE_DESCRIPTION}`}>
        <EnginePerformanceRows
          appearance={settings}
          Row={SettingsGroupRow}
          selectClassName={settingsRowSelect}
        />
      </SettingsGroup>
    </Dialog>
  );
}
