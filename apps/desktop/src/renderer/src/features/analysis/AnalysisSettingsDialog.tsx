import { useId } from "react";
import {
  ANALYSIS_DEPTH_RANGE,
  defaultSettings,
  type AnalysisLimit,
  type AppSettings,
  type EvalBarSide
} from "@chaturanga/shared/types/settings";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, SettingRow } from "@/components/ui/field";
import { Select } from "@/components/ui/input";
import { SectionHeader } from "@/components/ui/page";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { fieldHint } from "@/lib/ui";
import { useEnginesQuery, useSettingsQuery } from "../../queries/api";
import { EnginePerformanceSettings } from "../settings/EngineSettings";
import { useSetSetting } from "../settings/use-set-setting";
import { analysisEngineFor } from "./analysis-engine";

const lineOptions = [1, 2, 3, 4, 5].map((count) => ({
  value: String(count),
  label: String(count)
}));

const limitOptions: readonly { value: AnalysisLimit; label: string }[] = [
  { value: "infinite", label: "Until stopped" },
  { value: "depth", label: "Depth" },
  { value: "time", label: "Time" }
];

const sideOptions: readonly { value: EvalBarSide; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "right", label: "Right" }
];

/** Seconds per position offered for a timed search (Lichess and Chess.com offer similar steps). */
const TIME_OPTIONS_SEC = [1, 2, 3, 5, 10, 15, 30, 60, 120, 300];

/**
 * Live analysis settings, as Lichess and Chess.com offer them: the engine, how many lines, how far
 * to search (until stopped, a depth, or a time per position), threads and memory, and what the
 * board shows (best-move arrow, evaluation bar and its side). Changes apply at once: a running
 * analysis restarts with them.
 */
export function AnalysisSettingsDialog({ onClose }: { onClose: () => void }) {
  const ids = useId();
  const settingsQuery = useSettingsQuery();
  const settings: AppSettings = { ...defaultSettings, ...settingsQuery.data };
  const engines = useEnginesQuery();
  const usable = (engines.data ?? []).filter((engine) => engine.isAvailable);
  const engineId = analysisEngineFor(engines.data, settings.analysisEngineId);
  const setSetting = useSetSetting();
  const timeOptions = TIME_OPTIONS_SEC.includes(settings.analysisTimeSec)
    ? TIME_OPTIONS_SEC
    : [...TIME_OPTIONS_SEC, settings.analysisTimeSec].sort((a, b) => a - b);

  return (
    <Dialog
      title="Analysis settings"
      description="Changes apply right away; a running analysis restarts with them."
      onClose={onClose}
      bodyClassName="grid gap-6"
      footer={
        <Button type="button" variant="primary" size="sm" onClick={onClose}>
          Done
        </Button>
      }
    >
      <section className="grid gap-3">
        <SectionHeader as="h3" title="Engine" />
        <Field label="Engine" htmlFor={`${ids}-engine`}>
          <Select
            id={`${ids}-engine`}
            value={engineId ?? ""}
            disabled={!usable.length}
            onChange={(event) => setSetting("analysisEngineId", event.target.value || null)}
          >
            {usable.length ? null : <option value="">No engine installed</option>}
            {usable.map((engine) => (
              <option key={engine.id} value={engine.id}>
                {engine.name}
                {engine.isHumanPrediction ? " · human-like" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Lines" hint="best moves shown at once">
          <SegmentedControl
            ariaLabel="Lines"
            size="sm"
            fullWidth
            value={String(settings.analysisLines)}
            onChange={(value) => setSetting("analysisLines", Number(value))}
            options={lineOptions}
          />
        </Field>
        <Field label="Search" hint="per position">
          <div className="grid gap-2">
            <SegmentedControl
              ariaLabel="Search limit"
              size="sm"
              fullWidth
              value={settings.analysisLimit}
              onChange={(value) => setSetting("analysisLimit", value)}
              options={limitOptions}
            />
            {settings.analysisLimit === "depth" ? (
              <label className="flex items-center gap-3 text-sm text-fg-secondary">
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
                <span className="w-16 text-right font-mono tabular-nums">
                  depth {settings.analysisDepth}
                </span>
              </label>
            ) : settings.analysisLimit === "time" ? (
              <Select
                aria-label="Time per position"
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
          </div>
        </Field>
      </section>

      <section className="grid gap-1">
        <SectionHeader as="h3" title="Board" />
        <div className="grid divide-y divide-line-subtle">
          <SettingRow
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
          <SettingRow
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
          <SettingRow
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
        </div>
      </section>

      <EnginePerformanceSettings appearance={settings} />
    </Dialog>
  );
}
