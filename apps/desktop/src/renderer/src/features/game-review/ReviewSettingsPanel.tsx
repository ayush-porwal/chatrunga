import { engineDisplayName } from "@chaturanga/shared/engine/managed";
import { useEffect, useId, useState, type ReactNode } from "react";
import {
  REVIEW_MAIA_LEVELS,
  type AppSettings,
  type ReviewMaiaLevel,
  COMMENTARY_DETAILS
} from "@chaturanga/shared/types/settings";
import {
  useEnginesQuery,
  useOpenRouterConfigQuery,
  useUpdateSettingMutation
} from "../../queries/api";
import { pickMaiaEngines } from "./review-engine-picker";
import { useOpenSettings } from "../settings/settings-link";
import { reviewRatingLabel, useReviewRating } from "./use-review-rating";
import { reviewEngineFor } from "../analysis/analysis-engine";
import { EnginePicker, engineOption } from "../analysis/EnginePicker";
import { Badge, ChipButton } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  NestedSettingRow,
  SettingsGroup,
  SettingsGroupRow,
  settingsRowSelect
} from "@/components/ui/settings-group";
import { SideDot } from "@/components/ui/side-dot";
import { Switch } from "@/components/ui/switch";
import { fetchAssetStatus, maiaNeedsLc0 } from "@/lib/engine-assets";
import { isOneOf } from "@chaturanga/shared/types/guards";

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

/** Maia networks are installed but Lc0 isn't (Settings → Engines says what to do). */
function useMaiaNeedsLc0(): boolean {
  const [needsLc0, setNeedsLc0] = useState(false);
  useEffect(() => {
    let current = true;
    const refresh = () =>
      void fetchAssetStatus()
        .then((status) => {
          if (current) setNeedsLc0(maiaNeedsLc0(status));
        })
        .catch(() => undefined);
    refresh();
    const off = window.chaturanga?.onAssetStatusChanged(refresh);
    return () => {
      current = false;
      off?.();
    };
  }, []);
  return needsLc0;
}

/** The game's own review side (Review as), for the game review's settings dialog. */
export type ReviewSideSetting = {
  side: "white" | "black";
  whiteName: string;
  blackName: string;
  /** The rating the review is made for, and where it came from ("1533 · from the game"). */
  ratingLabel: string;
  onChange: (side: "white" | "black") => void;
};

/**
 * The review's settings as groups of rows, for a Dialog (the game review's and the puzzle
 * explanation's): Engine, then `board` when given, then Commentary.
 */
export function ReviewSettingsPanel({
  settings,
  reviewSide,
  board
}: {
  settings: AppSettings;
  /** The loaded game's side; without it the side control sets the Settings side. */
  reviewSide?: ReviewSideSetting;
  /** A group between Engine and Commentary (Game review's Board settings). */
  board?: ReactNode;
}) {
  const update = useUpdateSettingMutation();
  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    update.mutate({ key, value });
  return (
    <div className="grid content-start gap-3.5">
      <ReviewEngineGroup settings={settings} set={set} />
      {board}
      <ReviewCommentaryGroup settings={settings} reviewSide={reviewSide} set={set} />
    </div>
  );
}

type SetSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;

/**
 * The review's engine: which engine (automatic by default), how long it searches each move, how
 * many lines, whether the Engine tab lists them, and the Maia levels that predict human moves.
 */
function ReviewEngineGroup({ settings, set }: { settings: AppSettings; set: SetSetting }) {
  const ids = useId();
  const engines = useEnginesQuery();
  const availableEngines = engines.data ?? [];
  // Automatic: the engine a review runs on when none is chosen.
  const automaticEngine = reviewEngineFor(availableEngines, null);
  const engineOptions = [
    {
      value: "",
      engine: automaticEngine,
      label: automaticEngine
        ? `Automatic · ${engineDisplayName(automaticEngine.name)}`
        : "Choose an engine"
    },
    ...availableEngines
      .filter((engine) => !engine.isHumanPrediction)
      .map((engine) => engineOption(engine))
  ];
  const installedMaiaLevels = REVIEW_MAIA_LEVELS.filter((level) =>
    pickMaiaEngines(availableEngines).some((item) => item.maiaRating === level)
  );
  // null = every installed level (including ones downloaded later).
  const selectedMaiaLevels = settings.reviewMaiaLevels
    ? installedMaiaLevels.filter((level) => settings.reviewMaiaLevels?.includes(level))
    : installedMaiaLevels;
  const needsLc0 = useMaiaNeedsLc0();
  const toggleMaiaLevel = (level: ReviewMaiaLevel) => {
    const next = selectedMaiaLevels.includes(level)
      ? selectedMaiaLevels.filter((value) => value !== level)
      : installedMaiaLevels.filter(
          (value) => value === level || selectedMaiaLevels.includes(value)
        );
    set("reviewMaiaLevels", next.length === installedMaiaLevels.length ? null : next);
  };

  return (
    <SettingsGroup title="Engine">
      <SettingsGroupRow
        label="Evaluation engine"
        htmlFor={`${ids}-engine`}
        control={
          <EnginePicker
            id={`${ids}-engine`}
            ariaLabel="Evaluation engine"
            options={engineOptions}
            value={settings.defaultEngineId ?? ""}
            onChange={(value) => set("defaultEngineId", value || null)}
          />
        }
      />
      <SettingsGroupRow
        label="Search time"
        htmlFor={`${ids}-time`}
        description={`${estimateReviewTime(settings.reviewSearchTimeMs)} for a 40-move game`}
        control={
          <Select
            id={`${ids}-time`}
            className={settingsRowSelect}
            value={settings.reviewSearchTimeMs}
            onChange={(event) => set("reviewSearchTimeMs", Number(event.target.value))}
          >
            {searchTimeOptions.some(
              (option) => option.value === settings.reviewSearchTimeMs
            ) ? null : (
              <option value={settings.reviewSearchTimeMs}>
                Custom · {settings.reviewSearchTimeMs}ms
              </option>
            )}
            {searchTimeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        }
      />
      <SettingsGroupRow
        label="Engine lines"
        control={
          <SegmentedControl
            ariaLabel="Engine lines"
            size="sm"
            value={String(settings.reviewMultiPv)}
            onChange={(value) => set("reviewMultiPv", Number(value))}
            options={multiPvOptions}
          />
        }
      />
      <SettingsGroupRow
        label="Show alternatives in the Engine tab"
        htmlFor={`${ids}-alternatives`}
        control={
          <Switch
            id={`${ids}-alternatives`}
            checked={settings.reviewShowTopLines}
            onCheckedChange={(value) => set("reviewShowTopLines", value)}
          />
        }
      />
      <MaiaSetting
        enabled={settings.reviewUseMaia}
        installedLevels={installedMaiaLevels}
        selectedLevels={selectedMaiaLevels}
        needsLc0={needsLc0}
        onEnabledChange={(value) => set("reviewUseMaia", value)}
        onToggleLevel={toggleMaiaLevel}
      />
    </SettingsGroup>
  );
}

/**
 * The review's AI commentary: on or off (with the link to the one model and key in Settings → AI),
 * its detail, and the side it's written for (with the rating and the link to the ratings).
 */
function ReviewCommentaryGroup({
  settings,
  reviewSide,
  set
}: {
  settings: AppSettings;
  reviewSide: ReviewSideSetting | undefined;
  set: SetSetting;
}) {
  const ids = useId();
  const openRouter = useOpenRouterConfigQuery();
  // The rating a review of this game uses; edited (per mode) in app Settings.
  const rating = useReviewRating(settings, reviewSide?.side);
  const openSettings = useOpenSettings();
  const editRatings = openSettings ? (
    <Button variant="link" size="sm" onClick={() => openSettings("ratings")}>
      Edit ratings
    </Button>
  ) : null;
  return (
    <SettingsGroup title="Commentary">
      <SettingsGroupRow
        label="AI commentary"
        htmlFor={`${ids}-ai`}
        description={aiCommentaryDescription(
          openRouter.isLoading,
          Boolean(openRouter.data?.hasApiKey)
        )}
        control={
          <>
            {openSettings ? (
              <Button variant="link" size="sm" onClick={() => openSettings("ai")}>
                AI settings
              </Button>
            ) : null}
            <Switch
              id={`${ids}-ai`}
              checked={settings.reviewCommentaryEnabled}
              onCheckedChange={(value) => set("reviewCommentaryEnabled", value)}
            />
          </>
        }
      >
        <NestedSettingRow
          label="Detail"
          disabled={!settings.reviewCommentaryEnabled}
          control={
            <Select
              aria-label="Detail"
              className={settingsRowSelect}
              value={settings.reviewCommentaryDetail}
              onChange={(event) => {
                const detail = event.target.value;
                if (isOneOf(COMMENTARY_DETAILS, detail)) set("reviewCommentaryDetail", detail);
              }}
            >
              <option value="concise">Concise</option>
              <option value="balanced">Balanced</option>
              <option value="detailed">Detailed</option>
            </Select>
          }
        />
      </SettingsGroupRow>
      <ReviewSideRow
        reviewSide={reviewSide}
        settingsSide={settings.reviewPlayerColor}
        onSettingsSideChange={(value) => set("reviewPlayerColor", value)}
        editRatings={editRatings}
      />
      {/* A game's dialog says the rating under Review as (the rating its review is made for). */}
      {reviewSide ? null : (
        <SettingsGroupRow
          label="Rating"
          description={reviewRatingLabel(rating)}
          control={editRatings}
        />
      )}
    </SettingsGroup>
  );
}

/**
 * What AI commentary does, and whether the OpenRouter key every AI feature shares is saved
 * (nothing while that is read).
 */
function aiCommentaryDescription(loading: boolean, hasApiKey: boolean): string | undefined {
  if (loading) return undefined;
  return hasApiKey
    ? "Explains each move. A key is saved."
    : "Explains each move. No key saved yet.";
}

/**
 * Use Maia models, with the rating levels installed to pick from (all of them when none was
 * picked); at least one runs while Maia is on. Without one installed, it says what's missing.
 */
function MaiaSetting({
  enabled,
  installedLevels,
  selectedLevels,
  needsLc0,
  onEnabledChange,
  onToggleLevel
}: {
  enabled: boolean;
  installedLevels: readonly ReviewMaiaLevel[];
  selectedLevels: readonly ReviewMaiaLevel[];
  needsLc0: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onToggleLevel: (level: ReviewMaiaLevel) => void;
}) {
  const ids = useId();
  return (
    <SettingsGroupRow
      label="Use Maia models"
      htmlFor={`${ids}-maia`}
      description="Human move predictions by rating."
      control={
        <>
          {installedLevels.length ? null : (
            <Badge tone="warn">{needsLc0 ? "Needs Lc0" : "None installed"}</Badge>
          )}
          <Switch id={`${ids}-maia`} checked={enabled} onCheckedChange={onEnabledChange} />
        </>
      }
    >
      {installedLevels.length ? (
        <NestedSettingRow
          label="Rating levels"
          disabled={!enabled}
          control={
            <div role="group" aria-label="Maia rating levels" className="flex flex-wrap gap-1.5">
              {installedLevels.map((level) => {
                const selected = selectedLevels.includes(level);
                const onlyOne = selected && selectedLevels.length === 1;
                return (
                  <ChipButton
                    key={level}
                    selected={enabled && selected}
                    disabled={!enabled}
                    aria-disabled={onlyOne || undefined}
                    title={
                      onlyOne ? "At least one level runs. Turn Maia off instead." : `Maia ${level}`
                    }
                    aria-label={`Maia ${level}`}
                    onClick={() => {
                      if (!onlyOne) onToggleLevel(level);
                    }}
                    className="h-6 tabular-nums"
                  >
                    {level}
                  </ChipButton>
                );
              })}
            </div>
          }
        />
      ) : null}
    </SettingsGroupRow>
  );
}

/**
 * The side reviewed: in a game's dialog, the game's own (Review as, with the players' names under
 * it and the rating its review is made for); elsewhere, the Settings side.
 */
function ReviewSideRow({
  reviewSide,
  settingsSide,
  onSettingsSideChange,
  editRatings
}: {
  reviewSide: ReviewSideSetting | undefined;
  settingsSide: "white" | "black";
  onSettingsSideChange: (side: "white" | "black") => void;
  /** The link to the ratings in Settings, at the end of a game's Review as row. */
  editRatings: ReactNode;
}) {
  if (!reviewSide)
    return (
      <SettingsGroupRow
        label="Reviewing side"
        control={
          <SegmentedControl
            ariaLabel="Reviewing side"
            size="sm"
            value={settingsSide}
            onChange={onSettingsSideChange}
            options={[
              { value: "white", label: "White", icon: <SideDot color="white" /> },
              { value: "black", label: "Black", icon: <SideDot color="black" /> }
            ]}
          />
        }
      />
    );
  // The players' names make the control too wide for the row's right side: it goes under it.
  return (
    <SettingsGroupRow
      label="Review as"
      description={`Rating ${reviewSide.ratingLabel}`}
      control={editRatings}
    >
      <SegmentedControl
        ariaLabel="Review as"
        size="sm"
        fullWidth
        value={reviewSide.side}
        onChange={reviewSide.onChange}
        options={[
          {
            value: "white",
            label: `White · ${reviewSide.whiteName}`,
            icon: <SideDot color="white" />
          },
          {
            value: "black",
            label: `Black · ${reviewSide.blackName}`,
            icon: <SideDot color="black" />
          }
        ]}
      />
    </SettingsGroupRow>
  );
}
