import { useId, type ReactNode } from "react";
import { MAIA3_RATINGS } from "@chaturanga/shared/engine/maia3";
import { type AppSettings, COMMENTARY_DETAILS } from "@chaturanga/shared/types/settings";
import {
  useEnginesQuery,
  useOpenRouterConfigQuery,
  useUpdateSettingMutation
} from "../../queries/api";
import { useMaia3Installed } from "../../queries/maia";
import { useOpenSettings } from "../settings/settings-link";
import { MaiaDownloadPrompt } from "./MaiaDownloadPrompt";
import {
  reviewRatingLabel,
  sideRatingsLabel,
  useReviewRating,
  useReviewSideRatings
} from "./use-review-rating";
import { reviewEngineFor } from "../analysis/analysis-engine";
import { EnginePicker, engineOption } from "../analysis/EnginePicker";
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
 * The review's engine: which engine (the default engine unless another is chosen), how long it searches each move, how
 * many lines, whether the Engine tab lists them, and Maia (on or off, and the rating it reads).
 */
function ReviewEngineGroup({ settings, set }: { settings: AppSettings; set: SetSetting }) {
  const ids = useId();
  const engines = useEnginesQuery();
  const availableEngines = engines.data ?? [];
  // The engine a review runs on: the chosen one, else the default engine (Stockfish).
  const reviewEngine = reviewEngineFor(availableEngines, settings.defaultEngineId);
  const engineOptions = availableEngines
    .filter((engine) => !engine.isHumanPrediction)
    .map((engine) => engineOption(engine));

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
            value={reviewEngine?.id ?? null}
            onChange={(value) => set("defaultEngineId", value)}
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
      <MaiaSetting settings={settings} set={set} />
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
 * Use Maia (its download offered while Maia 3 isn't installed), and the rating it reads the moves
 * at: each side's own (the game's, else the user's; what that is for this game is said under it)
 * or one rating from 600 to 2600 for both.
 */
function MaiaSetting({ settings, set }: { settings: AppSettings; set: SetSetting }) {
  const ids = useId();
  const installed = useMaia3Installed();
  const sides = useReviewSideRatings(settings);
  const enabled = settings.reviewUseMaia;
  return (
    <SettingsGroupRow
      label="Use Maia"
      htmlFor={`${ids}-maia`}
      description="Human move predictions by rating."
      control={
        <>
          {installed === false ? <MaiaDownloadPrompt variant="button" /> : null}
          <Switch
            id={`${ids}-maia`}
            checked={enabled}
            onCheckedChange={(value) => set("reviewUseMaia", value)}
          />
        </>
      }
    >
      <NestedSettingRow
        label="Maia rating"
        disabled={!enabled}
        description={sideRatingsLabel(sides)}
        control={
          <Select
            aria-label="Maia rating"
            className={settingsRowSelect}
            disabled={!enabled}
            value={settings.reviewMaiaRating ?? ""}
            onChange={(event) =>
              set("reviewMaiaRating", event.target.value ? Number(event.target.value) : null)
            }
          >
            <option value="">Each side&apos;s rating</option>
            {MAIA3_RATINGS.map((rating) => (
              <option key={rating} value={rating}>
                {rating}
              </option>
            ))}
          </Select>
        }
      />
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
