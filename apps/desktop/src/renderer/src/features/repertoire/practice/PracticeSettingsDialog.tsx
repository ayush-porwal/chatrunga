import { useId } from "react";
import {
  NEW_PER_DAY_CHOICES,
  type NewPerDay,
  type RepertoirePracticeSettings
} from "@chaturanga/shared/types/repertoire-practice";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, SettingRow } from "@/components/ui/field";
import { Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useUpdateSettingMutation } from "../../../queries/api";
import { usePracticeSettings } from "../hub-tabs";

/** The choices in the order the select lists them: no limit first. */
const PER_DAY_OPTIONS: readonly NewPerDay[] = [null, ...NEW_PER_DAY_CHOICES.filter(Boolean)];

/**
 * Practice settings (the Practice tab's cog), for every repertoire: new positions per day, the
 * move shown the first time a position comes up, and right and wrong sounds. Each change is saved
 * at once. Cards, depth and chapters stay per repertoire (its own settings).
 */
export function PracticeSettingsDialog({ onClose }: { onClose: () => void }) {
  const ids = { perDay: useId(), show: useId(), sounds: useId() };
  const settings = usePracticeSettings();
  const { mutate } = useUpdateSettingMutation();
  const save = (patch: Partial<RepertoirePracticeSettings>) =>
    mutate({ key: "repertoirePractice", value: { ...settings, ...patch } });
  return (
    <Dialog
      size="sm"
      title="Practice settings"
      description="For every repertoire; cards, depth and chapters stay in each one's own settings."
      onClose={onClose}
      footer={
        <Button type="button" variant="primary" size="sm" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="grid gap-3">
        <Field
          label="New moves per day"
          hint="first answers, every repertoire"
          htmlFor={ids.perDay}
        >
          <Select
            id={ids.perDay}
            value={settings.newPerDay === null ? "none" : String(settings.newPerDay)}
            onChange={(event) => {
              const value = event.target.value;
              const choice = PER_DAY_OPTIONS.find((option) => String(option ?? "none") === value);
              if (choice !== undefined) save({ newPerDay: choice });
            }}
          >
            {PER_DAY_OPTIONS.map((option) => (
              <option key={String(option)} value={option === null ? "none" : String(option)}>
                {option === null ? "No limit" : option}
              </option>
            ))}
          </Select>
        </Field>
        <SettingRow
          label="Show the move on new positions"
          description="The first time a position comes up, its move is shown; play it to continue."
          htmlFor={ids.show}
          control={
            <Switch
              id={ids.show}
              checked={settings.showMoveOnNew}
              onCheckedChange={(checked) => save({ showMoveOnNew: checked })}
            />
          }
        />
        <SettingRow
          label="Right and wrong sounds"
          htmlFor={ids.sounds}
          control={
            <Switch
              id={ids.sounds}
              checked={settings.sounds}
              onCheckedChange={(checked) => save({ sounds: checked })}
            />
          }
        />
      </div>
    </Dialog>
  );
}
