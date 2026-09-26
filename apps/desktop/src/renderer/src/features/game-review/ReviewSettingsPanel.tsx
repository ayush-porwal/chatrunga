import { REVIEW_MAIA_LEVELS, type AppSettings, type ReviewMaiaLevel } from "@chaturanga/shared/types/settings";
import { useEnginesQuery, useUpdateSettingMutation } from "../../queries/api";
import { pickDefaultEngine, pickMaiaEngines } from "./review-engine-picker";
import { OpenRouterSettingsCard } from "../settings/OpenRouterSettingsCard";
import { Badge, ChipButton } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { Field, SettingRow } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { SectionHeader } from "@/components/ui/page";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SideDot } from "@/components/ui/side-dot";
import { Switch } from "@/components/ui/switch";
import { divider, fieldHint, fieldLabel } from "@/lib/ui";

const searchTimeOptions = [
  { value: 100, label: "Blitz · 0.1s" },
  { value: 250, label: "Fast · 0.25s" },
  { value: 500, label: "Balanced · 0.5s" },
  { value: 1000, label: "Deep · 1s" },
  { value: 2000, label: "Maximum · 2s" }
] as const;

const multiPvOptions = ["1", "2", "3", "4", "5"].map((value) => ({ value, label: value }));

/** Rough whole-review duration: one search per position of a 40-move (80-ply) game. */
function estimateReviewTime(searchTimeMs: number): string {
  const seconds = (81 * searchTimeMs) / 1000;
  return seconds < 90 ? `~${Math.round(seconds)}s` : `~${Math.round(seconds / 60)} min`;
}

const providerLabel: Record<AppSettings["reviewCommentaryProvider"], string> = {
  openrouter: "OpenRouter",
  local: "Local"
};

export function ReviewSettingsPanel({
  settings,
  onClose
}: {
  settings: AppSettings;
  onClose: () => void;
}) {
  const engines = useEnginesQuery();
  const update = useUpdateSettingMutation();
  const availableEngines = engines.data ?? [];
  const automaticEngine = pickDefaultEngine(availableEngines);
  const installedMaiaLevels = REVIEW_MAIA_LEVELS.filter((level) =>
    pickMaiaEngines(availableEngines).some((engine) => engine.maiaRating === level)
  );
  // null = every installed level (including ones downloaded later).
  const selectedMaiaLevels = settings.reviewMaiaLevels
    ? installedMaiaLevels.filter((level) => settings.reviewMaiaLevels?.includes(level))
    : installedMaiaLevels;
  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => update.mutate({ key, value });
  const toggleMaiaLevel = (level: ReviewMaiaLevel) => {
    const next = selectedMaiaLevels.includes(level)
      ? selectedMaiaLevels.filter((value) => value !== level)
      : installedMaiaLevels.filter((value) => value === level || selectedMaiaLevels.includes(value));
    set("reviewMaiaLevels", next.length === installedMaiaLevels.length ? null : next);
  };

  return (
    <div className="scroll-area -mr-3 grid h-full min-h-0 content-start gap-4 overflow-y-auto pr-3">
      <SectionHeader
        title="Review settings"
        actions={<Button variant="link" size="sm" onClick={onClose}>Done</Button>}
      />

      <section className="grid gap-3">
        <SectionHeader as="h3" title="Engine" />
        <Field label="Evaluation engine" htmlFor="review-engine">
          <Select id="review-engine" value={settings.defaultEngineId ?? ""} onChange={(event) => set("defaultEngineId", event.target.value || null)}>
            <option value="">{automaticEngine ? `Automatic · ${automaticEngine.name}` : "Choose an engine"}</option>
            {availableEngines.filter((engine) => !engine.isHumanPrediction).map((engine) => <option key={engine.id} value={engine.id}>{engine.name}</option>)}
          </Select>
        </Field>
        <Field label="Search time" hint="per move" htmlFor="review-time">
          <Select id="review-time" value={settings.reviewSearchTimeMs} onChange={(event) => set("reviewSearchTimeMs", Number(event.target.value))}>
            {searchTimeOptions.some((option) => option.value === settings.reviewSearchTimeMs) ? null : (
              <option value={settings.reviewSearchTimeMs}>Custom · {settings.reviewSearchTimeMs}ms</option>
            )}
            {searchTimeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
          <p className={fieldHint}>
            {estimateReviewTime(settings.reviewSearchTimeMs)} for a 40-move game. Longer searches give steadier evals and move grades.
          </p>
        </Field>
        <Field label="Engine lines" hint="alternatives per move">
          <SegmentedControl
            ariaLabel="Engine lines"
            size="sm"
            fullWidth
            value={String(settings.reviewMultiPv)}
            onChange={(value) => set("reviewMultiPv", Number(value))}
            options={multiPvOptions}
          />
        </Field>
        <SettingRow
          label="Show engine alternatives"
          description="List the extra lines in the Engine tab."
          control={<Switch checked={settings.reviewShowTopLines} onCheckedChange={(value) => set("reviewShowTopLines", value)} aria-label="Show engine alternatives" />}
        />
        <div className="grid gap-2">
          <SettingRow
            label="Use Maia models"
            description="Rating-aware human move predictions."
            className="py-0"
            control={
              <>
                {installedMaiaLevels.length ? null : <Badge tone="warn">None installed</Badge>}
                <Switch checked={settings.reviewUseMaia} onCheckedChange={(value) => set("reviewUseMaia", value)} aria-label="Use Maia models" />
              </>
            }
          />
          {installedMaiaLevels.length ? (
            <div role="group" aria-label="Maia rating levels" className="grid gap-1.5">
              <span className={fieldLabel}>Rating levels</span>
              <div className="flex flex-wrap gap-1.5">
                {installedMaiaLevels.map((level) => {
                  const selected = selectedMaiaLevels.includes(level);
                  const onlyOne = selected && selectedMaiaLevels.length === 1;
                  return (
                    <ChipButton
                      key={level}
                      selected={settings.reviewUseMaia && selected}
                      disabled={!settings.reviewUseMaia}
                      aria-disabled={onlyOne || undefined}
                      title={onlyOne ? "At least one level runs. Turn Maia off instead." : `Maia ${level}`}
                      aria-label={`Maia ${level}`}
                      onClick={() => {
                        if (!onlyOne) toggleMaiaLevel(level);
                      }}
                      className="tabular-nums"
                    >
                      {level}
                    </ChipButton>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <div className={divider} />

      <section className="grid gap-3">
        <SectionHeader as="h3" title="Commentary" />
        <SettingRow
          label="AI commentary"
          description="Explain each move from the engine evidence."
          control={<Switch checked={settings.reviewCommentaryEnabled} onCheckedChange={(value) => set("reviewCommentaryEnabled", value)} aria-label="AI commentary" />}
        />
        <Field label="Detail" htmlFor="review-detail">
          <Select id="review-detail" value={settings.reviewCommentaryDetail} onChange={(event) => set("reviewCommentaryDetail", event.target.value as AppSettings["reviewCommentaryDetail"])}>
            <option value="concise">Concise</option>
            <option value="balanced">Balanced</option>
            <option value="detailed">Detailed</option>
          </Select>
        </Field>
        <Field label="Reviewing side">
          <SegmentedControl
            ariaLabel="Reviewing side"
            fullWidth
            value={settings.reviewPlayerColor}
            onChange={(value) => set("reviewPlayerColor", value)}
            options={[
              { value: "white", label: "White", icon: <SideDot color="white" /> },
              { value: "black", label: "Black", icon: <SideDot color="black" /> }
            ]}
          />
        </Field>
        <Field label="Your rating" hint="400–3500" htmlFor="review-rating">
          <Input id="review-rating" type="number" min={400} max={3500} step={10} value={settings.reviewPlayerRating} onChange={(event) => set("reviewPlayerRating", Math.round(Math.max(400, Math.min(3500, Number(event.target.value) || 1500))))} />
        </Field>
        <Disclosure title="Commentary source" summary={providerLabel[settings.reviewCommentaryProvider]}>
          <OpenRouterSettingsCard />
        </Disclosure>
      </section>
    </div>
  );
}
