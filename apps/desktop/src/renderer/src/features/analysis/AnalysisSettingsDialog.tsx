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
import { SegmentedControl, tabPanelProps } from "@/components/ui/segmented-control";
import { SettingsGroup, SettingsGroupRow, settingsRowSelect } from "@/components/ui/settings-group";
import { fieldHint } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useEnginesQuery, useSettingsQuery } from "../../queries/api";
import { BoardSettingsGroup } from "../board/BoardSettingsGroup";
import { ReviewSettingsPanel } from "../game-review/ReviewSettingsPanel";
import type { BoardSettingsTab } from "../../stores/board-settings-store";
import {
  ENGINE_PERFORMANCE_DESCRIPTION,
  EnginePerformanceRows
} from "../settings/engine-performance";
import { useSetSetting } from "../settings/use-set-setting";
import { analysisEngineFor, isAnalysisEngine } from "./analysis-engine";
import { EnginePicker, engineOption } from "./EnginePicker";

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

const tabOptions: readonly { value: BoardSettingsTab; label: string }[] = [
  { value: "analysis", label: "Analysis" },
  { value: "explanation", label: "Puzzle explanation" }
];

const TAB_DESCRIPTIONS: Record<BoardSettingsTab, string> = {
  analysis: "Changes apply right away; a running analysis restarts with them.",
  explanation:
    "Shared with Game review: the engine that analyses the puzzle and the AI that explains it."
};

/**
 * The game view's settings, from the Moves tab's cog. On a puzzle board two tabs: Analysis, and
 * the puzzle explanation's engine and AI commentary (Game review's settings); elsewhere only
 * Analysis. Changes apply at once.
 */
export function AnalysisSettingsDialog({
  tab,
  onTabChange,
  withExplanation,
  onClose
}: {
  tab: BoardSettingsTab;
  onTabChange: (tab: BoardSettingsTab) => void;
  /** A puzzle board: the explanation's settings get a tab of their own. */
  withExplanation: boolean;
  onClose: () => void;
}) {
  const panelId = useId();
  const settingsQuery = useSettingsQuery();
  const settings: AppSettings = { ...defaultSettings, ...settingsQuery.data };
  const shown = withExplanation ? tab : "analysis";
  return (
    <Dialog
      title={withExplanation ? "Settings" : "Analysis settings"}
      description={TAB_DESCRIPTIONS[shown]}
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
      {withExplanation ? (
        <SegmentedControl
          ariaLabel="Settings"
          role="tablist"
          fullWidth
          size="sm"
          panelId={panelId}
          value={shown}
          onChange={onTabChange}
          options={tabOptions}
        />
      ) : null}
      <div {...(withExplanation ? tabPanelProps(panelId, shown) : {})} className="grid gap-3.5">
        {shown === "analysis" ? (
          <AnalysisSettingsGroups settings={settings} />
        ) : (
          <ReviewSettingsPanel settings={settings} />
        )}
      </div>
    </Dialog>
  );
}

/**
 * Live analysis settings, as Lichess and Chess.com offer them, in three groups of rows: Engine
 * (which engine, how many lines, how far to search: until stopped, a depth, or a time per
 * position), Board (the engine arrows and the evaluation bar, shared with Review settings) and
 * Performance (threads and memory). A running analysis restarts with a change.
 */
function AnalysisSettingsGroups({ settings }: { settings: AppSettings }) {
  const ids = useId();
  const engines = useEnginesQuery();
  const engineId = analysisEngineFor(engines.data, settings.analysisEngineId);
  // Every installed engine that analyses (not Maia); one that can't run is listed but can't be
  // chosen (none usable: the picker says none is installed).
  const engineOptions = engineId
    ? (engines.data ?? []).filter(isAnalysisEngine).map((item) => engineOption(item))
    : [];
  const setSetting = useSetSetting();
  const timeOptions = TIME_OPTIONS_SEC.includes(settings.analysisTimeSec)
    ? TIME_OPTIONS_SEC
    : [...TIME_OPTIONS_SEC, settings.analysisTimeSec].sort((a, b) => a - b);

  return (
    <>
      <SettingsGroup title="Engine">
        <SettingsGroupRow
          label="Engine"
          htmlFor={`${ids}-engine`}
          control={
            <EnginePicker
              id={`${ids}-engine`}
              ariaLabel="Engine"
              options={engineOptions}
              value={engineId}
              onChange={(value) => setSetting("analysisEngineId", value)}
            />
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
    </>
  );
}
