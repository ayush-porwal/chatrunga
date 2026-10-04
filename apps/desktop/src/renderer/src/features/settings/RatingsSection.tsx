import { useState } from "react";
import {
  clampRating,
  isRatingLocked,
  RATING_MODE_LABELS,
  RATING_MODES,
  RATING_RANGE,
  setManualRating,
  type ModeRating,
  type RatingMode
} from "@chaturanga/shared/types/ratings";
import type { AppSettings } from "@chaturanga/shared/types/settings";
import { Input } from "@/components/ui/input";
import { cardPadded, fieldLabel, sectionDescription } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useSetSetting } from "./use-set-setting";

/**
 * Settings → Ratings: the player's rating per Lichess mode, in one row of five cells. Game review
 * uses the one for a game's mode when the game has no rating of its own. With Lichess connected
 * every mode comes from the account and reads as plain text; otherwise each is an input.
 */
export function RatingsSection({ appearance }: { appearance: AppSettings }) {
  const setSetting = useSetSetting();
  const ratings = appearance.playerRatings;
  return (
    <section className={cn(cardPadded, "grid gap-3")}>
      <p className={sectionDescription}>
        Reviews use the game&rsquo;s own rating, else these. With Lichess connected, they come from
        your account.
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 @md:grid-cols-3 @2xl:grid-cols-5">
        {RATING_MODES.map((mode) => (
          <RatingCell
            // A new stored value (typed, synced, another screen) starts the field afresh.
            key={`${mode}:${ratings[mode].rating}`}
            mode={mode}
            rating={ratings[mode]}
            onChange={(value) => setSetting("playerRatings", setManualRating(ratings, mode, value))}
          />
        ))}
      </div>
    </section>
  );
}

function RatingCell({
  mode,
  rating,
  onChange
}: {
  mode: RatingMode;
  rating: ModeRating;
  onChange: (rating: number) => void;
}) {
  const id = `setting-rating-${mode}`;
  const label = RATING_MODE_LABELS[mode];
  const [text, setText] = useState(String(rating.rating));
  if (isRatingLocked(rating)) {
    return (
      <div role="group" aria-labelledby={`${id}-label`} className="grid min-w-0 gap-1">
        <span id={`${id}-label`} className={cn(fieldLabel, "truncate")}>
          {label}
        </span>
        <span className="flex h-8 items-center text-sm text-fg tabular-nums">{rating.rating}</span>
      </div>
    );
  }
  const commit = () => {
    const value = Number(text);
    if (text.trim() && Number.isFinite(value) && Math.round(value) !== rating.rating) {
      const clamped = clampRating(value);
      setText(String(clamped));
      onChange(clamped);
    } else setText(String(rating.rating));
  };
  return (
    <div className="grid min-w-0 gap-1">
      <label htmlFor={id} className={cn(fieldLabel, "truncate")}>
        {label}
      </label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={RATING_RANGE.min}
        max={RATING_RANGE.max}
        step={10}
        className="h-8 max-w-28 px-2.5 tabular-nums"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
      />
    </div>
  );
}
