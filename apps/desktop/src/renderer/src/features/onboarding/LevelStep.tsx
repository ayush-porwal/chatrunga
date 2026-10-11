import { useState, type KeyboardEvent } from "react";
import { Check } from "lucide-react";
import {
  boardThemeSquareColors,
  type AppSettings,
  type BoardTheme
} from "@chaturanga/shared/types/settings";
import { applyRatingToAllModes, headlineRating } from "@chaturanga/shared/types/ratings";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SideDot } from "@/components/ui/side-dot";
import { fieldHint, fieldLabel, focusRing, motion } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { useSetSetting } from "../settings/use-set-setting";
import { LEVEL_PRESETS, clampRating, nearestLevelPreset } from "./onboarding-state";
import { PrimaryButton, StepFooter, StepHeader, type StepHeadingProps } from "./StepChrome";

const themeSwatches: { id: BoardTheme; label: string }[] = [
  { id: "brown", label: "Brown" },
  { id: "green", label: "Green" },
  { id: "blue", label: "Blue" },
  { id: "slate", label: "Slate" }
];

export function LevelStep({
  settings,
  setSetting,
  onBack,
  onNext,
  footer,
  ...heading
}: StepHeadingProps & {
  settings: AppSettings;
  setSetting: ReturnType<typeof useSetSetting>;
  onBack: () => void;
  onNext: () => void;
}) {
  // One rating, for every mode (Settings → Ratings has them one by one).
  const yourRating = headlineRating(settings.playerRatings);
  const [ratingText, setRatingText] = useState(String(yourRating));
  const selected = nearestLevelPreset(yourRating);
  const exact = LEVEL_PRESETS.some((preset) => preset.rating === yourRating);
  const customTheme = Boolean(settings.boardSquareLight || settings.boardSquareDark);
  const applyRating = (rating: number) =>
    setSetting("playerRatings", applyRatingToAllModes(settings.playerRatings, rating));

  const setRating = (rating: number) => {
    setRatingText(String(rating));
    applyRating(rating);
  };

  return (
    <>
      <StepHeader {...heading} title="Your level">
        <p>
          The coach pitches its explanations to your rating, and Maia shows what players around it
          would play.
        </p>
      </StepHeader>

      <fieldset className="grid gap-2">
        <legend className={cn(fieldLabel, "mb-2")}>Your rating</legend>
        <div role="radiogroup" aria-label="Your rating" className="grid grid-cols-5 gap-2">
          {LEVEL_PRESETS.map((preset) => {
            const checked = selected.rating === preset.rating;
            return (
              <button
                key={preset.rating}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
                onClick={() => setRating(preset.rating)}
                onKeyDown={(event) =>
                  radioKeys(
                    event,
                    LEVEL_PRESETS.map((item) => item.rating),
                    preset.rating,
                    setRating
                  )
                }
                className={cn(
                  "grid min-w-0 gap-0.5 rounded-lg border px-2.5 py-2 text-left",
                  motion.press,
                  focusRing,
                  checked
                    ? "border-accent/50 bg-accent-soft text-fg"
                    : "border-line bg-surface text-fg-secondary hover:border-line-strong hover:bg-control"
                )}
              >
                <span
                  className={cn(
                    "text-base font-semibold tabular-nums",
                    checked ? "text-accent-fg" : "text-fg"
                  )}
                >
                  {checked && !exact ? yourRating : preset.rating}
                </span>
                <span className="truncate text-2xs text-fg-muted">{preset.label}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <label htmlFor="onboarding-rating" className="text-xs text-fg-muted">
            Or type it
          </label>
          <Input
            id="onboarding-rating"
            type="number"
            inputMode="numeric"
            min={400}
            max={3500}
            step={10}
            className="h-8 w-24 tabular-nums"
            value={ratingText}
            onChange={(event) => {
              setRatingText(event.target.value);
              const value = Number(event.target.value);
              if (event.target.value && value >= 400 && value <= 3500)
                applyRating(Math.round(value));
            }}
            onBlur={() => setRating(clampRating(Number(ratingText) || yourRating))}
          />
          <span className={fieldHint}>Any rating system is fine; a guess works too.</span>
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-6">
        <div className="grid content-start gap-2">
          <span className={fieldLabel}>Side you usually review</span>
          <div className="flex h-10 items-center">
            <SegmentedControl
              ariaLabel="Side you usually review"
              className="w-full"
              fullWidth
              value={settings.reviewPlayerColor}
              onChange={(value) => setSetting("reviewPlayerColor", value)}
              options={[
                { value: "white", label: "White", icon: <SideDot color="white" /> },
                { value: "black", label: "Black", icon: <SideDot color="black" /> }
              ]}
            />
          </div>
          <p className={fieldHint}>Explanations are written for this side.</p>
        </div>

        <div className="grid content-start gap-2">
          <span className={fieldLabel}>Board</span>
          <div
            role="radiogroup"
            aria-label="Board colours"
            className="flex h-10 items-center gap-2"
          >
            {themeSwatches.map((theme) => {
              const checked = !customTheme && settings.boardTheme === theme.id;
              const colors = boardThemeSquareColors[theme.id];
              return (
                <button
                  key={theme.id}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  aria-label={theme.label}
                  title={theme.label}
                  tabIndex={
                    checked ||
                    (customTheme && theme.id === "brown") ||
                    (!themeSwatches.some((t) => t.id === settings.boardTheme) &&
                      theme.id === "brown")
                      ? 0
                      : -1
                  }
                  onClick={() => pickTheme(setSetting, theme.id)}
                  onKeyDown={(event) =>
                    radioKeys(
                      event,
                      themeSwatches.map((item) => item.id),
                      theme.id,
                      (id) => pickTheme(setSetting, id)
                    )
                  }
                  className={cn(
                    "relative size-9 overflow-hidden rounded-lg ring-offset-2 ring-offset-canvas",
                    motion.press,
                    // The selected swatch already wears the accent ring: keyboard focus is a light one.
                    "outline-none focus-visible:ring-2 focus-visible:ring-fg",
                    checked ? "ring-2 ring-accent" : "ring-1 ring-line hover:ring-line-strong"
                  )}
                  style={{
                    background: `conic-gradient(${colors.dark} 25%, ${colors.light} 0 50%, ${colors.dark} 0 75%, ${colors.light} 0) 0 0 / 50% 50%`
                  }}
                >
                  {checked ? (
                    <span className="absolute inset-0 grid place-items-center bg-black/25 text-white">
                      <Check className="size-4" strokeWidth={2.5} aria-hidden />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <p className={fieldHint}>More in Settings, Board.</p>
        </div>
      </div>

      <StepFooter
        footer={footer}
        back={onBack}
        primary={<PrimaryButton onClick={onNext}>Continue</PrimaryButton>}
      />
    </>
  );
}

/** A theme and its (reset) square colors are one write, never half-applied. */
function pickTheme(setSetting: ReturnType<typeof useSetSetting>, theme: BoardTheme) {
  setSetting.many({ boardTheme: theme, boardSquareLight: null, boardSquareDark: null });
}

/** Arrow keys move the selection inside a custom radiogroup (and focus follows it). */
function radioKeys<T>(
  event: KeyboardEvent<HTMLButtonElement>,
  values: readonly T[],
  current: T,
  select: (value: T) => void
) {
  const delta =
    event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : 0;
  if (!delta) return;
  event.preventDefault();
  const index = (values.indexOf(current) + delta + values.length) % values.length;
  select(values[index]);
  const buttons =
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
  buttons?.[index]?.focus();
}
