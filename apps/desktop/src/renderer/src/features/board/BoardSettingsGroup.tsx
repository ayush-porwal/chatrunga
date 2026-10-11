import { useId } from "react";
import {
  ANALYSIS_PLAN_ARROWS,
  type AppSettings,
  type EvalBarSide
} from "@chaturanga/shared/types/settings";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { NestedSettingRow, SettingsGroup, SettingsGroupRow } from "@/components/ui/settings-group";
import { Switch } from "@/components/ui/switch";
import { useSetSetting } from "../settings/use-set-setting";

const planOptions = ANALYSIS_PLAN_ARROWS.map((count) => ({
  value: String(count),
  label: count ? String(count) : "Best move"
}));

const sideOptions: readonly { value: EvalBarSide; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "right", label: "Right" }
];

/** A segmented control's options, every one unavailable while its parent setting is off. */
function withDisabled<T extends { value: string; label: string }>(
  options: readonly T[],
  disabled: boolean
): (T & { disabled: boolean })[] {
  return options.map((option) => ({ ...option, disabled }));
}

/**
 * The board's analysis settings, one group shared by Analysis settings and Review settings (the
 * same saved settings in both): the engine arrows (the best move alone, or the next 2–4 moves of
 * its line numbered) and the evaluation bar with its side.
 */
export function BoardSettingsGroup({ settings }: { settings: AppSettings }) {
  const ids = useId();
  const setSetting = useSetSetting();
  return (
    <SettingsGroup title="Board">
      <SettingsGroupRow
        label="Engine arrows"
        htmlFor={`${ids}-arrow`}
        description="The engine's top line, in Analyze and Game review."
        control={
          <Switch
            id={`${ids}-arrow`}
            checked={settings.analysisBestMoveArrow}
            onCheckedChange={(value) => setSetting("analysisBestMoveArrow", value)}
          />
        }
      >
        <NestedSettingRow
          label="Show"
          description="Numbered arrows for the next moves of the engine's idea."
          disabled={!settings.analysisBestMoveArrow}
          control={
            <SegmentedControl
              ariaLabel="Engine arrows shown"
              size="sm"
              value={String(settings.analysisPlanArrows)}
              onChange={(value) => {
                const count = ANALYSIS_PLAN_ARROWS.find((option) => String(option) === value);
                if (count !== undefined) setSetting("analysisPlanArrows", count);
              }}
              options={withDisabled(planOptions, !settings.analysisBestMoveArrow)}
            />
          }
        />
      </SettingsGroupRow>
      <SettingsGroupRow
        label="Evaluation bar"
        htmlFor={`${ids}-bar`}
        description="Beside the board, in Analyze and Game review."
        control={
          <Switch
            id={`${ids}-bar`}
            checked={settings.analysisEvalBar}
            onCheckedChange={(value) => setSetting("analysisEvalBar", value)}
          />
        }
      >
        <NestedSettingRow
          label="Bar position"
          disabled={!settings.analysisEvalBar}
          control={
            <SegmentedControl
              ariaLabel="Evaluation bar position"
              size="sm"
              value={settings.analysisEvalBarSide}
              onChange={(value) => setSetting("analysisEvalBarSide", value)}
              options={withDisabled(sideOptions, !settings.analysisEvalBar)}
            />
          }
        />
      </SettingsGroupRow>
    </SettingsGroup>
  );
}
