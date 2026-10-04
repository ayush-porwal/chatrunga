import { useState } from "react";
import { Lock } from "lucide-react";
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
import { SettingRow } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/ui/page";
import { cardPadded } from "@/lib/ui";
import { useMinuteClock } from "@/lib/use-minute-clock";
import { cn } from "@/lib/utils";
import { ratingSourceLabel } from "./rating-labels";
import { useSetSetting } from "./use-set-setting";

/**
 * Settings → Ratings: the player's rating per Lichess mode. Game review uses the one for a game's
 * mode when the game has no rating of its own. With Lichess connected the modes fill from the
 * account; a synced rating Lichess doesn't call provisional can't be edited here.
 */
export function RatingsSection({ appearance }: { appearance: AppSettings }) {
  const setSetting = useSetSetting();
  const now = useMinuteClock();
  const ratings = appearance.playerRatings;
  return (
    <section className={cn(cardPadded, "grid gap-2")}>
      <SectionHeader
        title="Ratings"
        description="Game review pitches Maia and the coach to your rating for the game's time control, when the game doesn't carry one. With Lichess connected, they come from your account."
      />
      <div className="grid divide-y divide-line-subtle">
        {RATING_MODES.map((mode) => (
          <RatingRow
            // A new stored value (typed, synced, another screen) starts the field afresh.
            key={`${mode}:${ratings[mode].rating}`}
            mode={mode}
            rating={ratings[mode]}
            now={now}
            onChange={(value) => setSetting("playerRatings", setManualRating(ratings, mode, value))}
          />
        ))}
      </div>
    </section>
  );
}

function RatingRow({
  mode,
  rating,
  now,
  onChange
}: {
  mode: RatingMode;
  rating: ModeRating;
  now: number;
  onChange: (rating: number) => void;
}) {
  const id = `setting-rating-${mode}`;
  const locked = isRatingLocked(rating);
  const [text, setText] = useState(String(rating.rating));
  const commit = () => {
    const value = Number(text);
    if (text.trim() && Number.isFinite(value) && Math.round(value) !== rating.rating) {
      const clamped = clampRating(value);
      setText(String(clamped));
      onChange(clamped);
    } else setText(String(rating.rating));
  };
  return (
    <SettingRow
      label={RATING_MODE_LABELS[mode]}
      htmlFor={id}
      description={ratingSourceLabel(rating, now)}
      control={
        <>
          {locked ? (
            <Lock className="size-3.5 text-fg-subtle" aria-label="Synced from Lichess" />
          ) : null}
          <Input
            id={id}
            type="number"
            inputMode="numeric"
            min={RATING_RANGE.min}
            max={RATING_RANGE.max}
            step={10}
            className="h-8 w-24 tabular-nums"
            value={text}
            readOnly={locked}
            disabled={locked}
            title={locked ? "Synced from your Lichess account" : undefined}
            onChange={(event) => setText(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit();
            }}
          />
        </>
      }
    />
  );
}
