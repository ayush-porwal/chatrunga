import { useEffect, useState } from "react";
import {
  REVIEW_MAIA_LEVELS,
  type AppSettings,
  type ReviewMaiaLevel
} from "@chaturanga/shared/types/settings";
import {
  useEnginesQuery,
  useOpenRouterConfigQuery,
  useUpdateSettingMutation
} from "../../queries/api";
import { pickDefaultEngine, pickMaiaEngines } from "./review-engine-picker";
import { useOpenSettings } from "../settings/settings-link";
import { reviewRatingLabel, useReviewRating } from "./use-review-rating";
import { Badge, ChipButton } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, SettingRow } from "@/components/ui/field";
import { Select } from "@/components/ui/input";
import { SectionHeader } from "@/components/ui/page";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SideDot } from "@/components/ui/side-dot";
import { Switch } from "@/components/ui/switch";
import { fetchAssetStatus, maiaNeedsLc0 } from "@/lib/engine-assets";
import { divider, fieldHint, fieldLabel } from "@/lib/ui";
import { isOneOf } from "@chaturanga/shared/types/guards";
import { COMMENTARY_DETAILS } from "@chaturanga/shared/types/settings";

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

/** Maia networks are installed but Lc0 isn't (Settings → Engine downloads says what to do). */
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

export function ReviewSettingsPanel({
  settings,
  onClose,
  embedded = false,
  reviewSide
}: {
  settings: AppSettings;
  onClose: () => void;
  /** Inside a Dialog (the review's and the puzzle explanation's settings): the dialog has the title, Done and scrolling. */
  embedded?: boolean;
  /** The loaded game's side; without it the side control sets the Settings side. */
  reviewSide?: ReviewSideSetting;
}) {
  const engines = useEnginesQuery();
  const openRouter = useOpenRouterConfigQuery();
  const hasApiKey = Boolean(openRouter.data?.hasApiKey);
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
  const needsLc0 = useMaiaNeedsLc0();
  // The rating a review of this game uses; edited (per mode) in app Settings.
  const rating = useReviewRating(settings, reviewSide?.side);
  const openSettings = useOpenSettings();
  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    update.mutate({ key, value });
  const toggleMaiaLevel = (level: ReviewMaiaLevel) => {
    const next = selectedMaiaLevels.includes(level)
      ? selectedMaiaLevels.filter((value) => value !== level)
      : installedMaiaLevels.filter(
          (value) => value === level || selectedMaiaLevels.includes(value)
        );
    set("reviewMaiaLevels", next.length === installedMaiaLevels.length ? null : next);
  };

  return (
    <div
      className={
        embedded
          ? "grid content-start gap-4"
          : "scroll-area -mr-3 grid h-full min-h-0 content-start gap-4 overflow-y-auto pr-3"
      }
    >
      {embedded ? null : (
        <SectionHeader
          title="Review settings"
          actions={
            <Button variant="link" size="sm" onClick={onClose}>
              Done
            </Button>
          }
        />
      )}

      <CollapsibleSection
        size="sub"
        storageKey="review-settings:engine"
        title="Engine"
        bodyClassName="grid gap-3 pt-2"
      >
        <Field label="Evaluation engine" htmlFor="review-engine">
          <Select
            id="review-engine"
            value={settings.defaultEngineId ?? ""}
            onChange={(event) => set("defaultEngineId", event.target.value || null)}
          >
            <option value="">
              {automaticEngine ? `Automatic · ${automaticEngine.name}` : "Choose an engine"}
            </option>
            {availableEngines
              .filter((engine) => !engine.isHumanPrediction)
              .map((engine) => (
                <option key={engine.id} value={engine.id}>
                  {engine.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Search time" hint="per move" htmlFor="review-time">
          <Select
            id="review-time"
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
          <p className={fieldHint}>
            {estimateReviewTime(settings.reviewSearchTimeMs)} for a 40-move game. Longer searches
            give steadier evals and move grades.
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
          control={
            <Switch
              checked={settings.reviewShowTopLines}
              onCheckedChange={(value) => set("reviewShowTopLines", value)}
              aria-label="Show engine alternatives"
            />
          }
        />
        <div className="grid gap-2">
          <SettingRow
            label="Use Maia models"
            description="Rating-aware human move predictions."
            className="py-0"
            control={
              <>
                {installedMaiaLevels.length ? null : (
                  <Badge tone="warn">{needsLc0 ? "Needs Lc0" : "None installed"}</Badge>
                )}
                <Switch
                  checked={settings.reviewUseMaia}
                  onCheckedChange={(value) => set("reviewUseMaia", value)}
                  aria-label="Use Maia models"
                />
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
                      title={
                        onlyOne
                          ? "At least one level runs. Turn Maia off instead."
                          : `Maia ${level}`
                      }
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
      </CollapsibleSection>

      <div className={divider} />

      <CollapsibleSection
        size="sub"
        storageKey="review-settings:commentary"
        title="Commentary"
        bodyClassName="grid gap-3 pt-2"
      >
        <SettingRow
          label="AI commentary"
          description="Explain each move from the engine evidence."
          control={
            <Switch
              checked={settings.reviewCommentaryEnabled}
              onCheckedChange={(value) => set("reviewCommentaryEnabled", value)}
              aria-label="AI commentary"
            />
          }
        />
        <Field label="Detail" htmlFor="review-detail">
          <Select
            id="review-detail"
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
        </Field>
        {reviewSide ? (
          <Field label="Review as">
            <SegmentedControl
              ariaLabel="Review as"
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
            <p className={fieldHint}>Rating {reviewSide.ratingLabel}</p>
          </Field>
        ) : (
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
        )}
        <SettingRow
          label="Rating"
          // A game's dialog already says it under Review as (the rating its review is made for).
          description={reviewSide ? undefined : reviewRatingLabel(rating)}
          control={
            openSettings ? (
              <Button variant="link" size="sm" onClick={() => openSettings("ratings")}>
                Edit ratings
              </Button>
            ) : null
          }
        />
        <SettingRow
          label="Model and API key"
          description={
            openRouter.isLoading
              ? undefined
              : hasApiKey
                ? "Shared by every AI feature. A key is saved."
                : "Shared by every AI feature. No key saved yet."
          }
          control={
            openSettings ? (
              <Button variant="link" size="sm" onClick={() => openSettings("ai")}>
                AI settings
              </Button>
            ) : null
          }
        />
      </CollapsibleSection>
    </div>
  );
}
