import { useCallback, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { Play, Sparkles } from "lucide-react";
import type { Color } from "@chaturanga/shared/types/chess";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { PieceArt, useBoardSquareColors } from "../play/piece-art";
import { chooseReviewSide, type ReviewSide } from "./review-side";

/** A piece drawn as the empty states' illustration (the Play page's tilt and shadow). */
const ILLUSTRATION = "size-24 drop-shadow-[0_8px_10px_rgb(0_0_0/0.45)]";
const TILT = { transform: "rotate(-8deg)" };

/**
 * The Summary tab: the finished review's `summary`; while one runs, a wait; without one, the side
 * to review the game for (asked first, for an imported game) or the way to analyse it.
 */
export function ReviewSummaryTab({
  running,
  hasReview,
  summary,
  reviewSide,
  players,
  onAnalyze
}: {
  running: boolean;
  hasReview: boolean;
  summary: ReactNode;
  reviewSide: ReviewSide;
  players: { white: { name: string }; black: { name: string } };
  /** Starts the engine review (the titlebar's Analyze); absent while it can't. */
  onAnalyze?: () => void;
}) {
  const startSideReview = useCallback(
    (picked: Color) => {
      chooseReviewSide(picked);
      onAnalyze?.();
    },
    [onAnalyze]
  );
  if (running)
    return (
      <div className="grid h-full place-items-center">
        <EmptyState
          icon={<PieceArt color="white" piece="knight" className={ILLUSTRATION} style={TILT} />}
          title="Analyzing…"
        />
      </div>
    );
  if (hasReview) return summary;
  if (reviewSide.status === "ask")
    return (
      <ReviewSidePrompt
        preselect={reviewSide.preselect}
        whiteName={players.white.name}
        blackName={players.black.name}
        onStart={onAnalyze ? startSideReview : undefined}
      />
    );
  return (
    <div className="grid h-full place-items-center">
      <EmptyState
        icon={<PieceArt color="white" piece="bishop" className={ILLUSTRATION} style={TILT} />}
        title="No review yet"
        action={
          onAnalyze ? (
            <Button variant="primary" size="sm" onClick={onAnalyze}>
              <Sparkles />
              Analyze
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}

/**
 * Before an imported game's first review, centred in the panel: which side to review it as, each a
 * tile with that side's king on a board square, the side whose name is the user's Lichess account
 * (else the Settings side) preselected, then Start review.
 */
function ReviewSidePrompt({
  preselect,
  whiteName,
  blackName,
  onStart
}: {
  preselect: Color;
  whiteName: string;
  blackName: string;
  /** Reviews the game as the side picked; absent while it can't start (the game is loading). */
  onStart?: (side: Color) => void;
}) {
  const headingId = useId();
  const squares = useBoardSquareColors();
  const [picked, setPicked] = useState<Color>(preselect);
  // A preselection that changes (the Lichess account connects) moves the pick until one is made.
  const [touched, setTouched] = useState(false);
  const side = touched ? picked : preselect;
  const options: { color: Color; name: string; square: string }[] = [
    // Each king on the opposite square colour, so both stand out.
    { color: "white", name: whiteName, square: squares.dark },
    { color: "black", name: blackName, square: squares.light }
  ];
  const pick = (color: Color) => {
    setTouched(true);
    setPicked(color);
  };
  // A radio group: Tab reaches the picked side only, and the arrow keys move the pick (and focus).
  const onRadioKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const next: Color = side === "white" ? "black" : "white";
    pick(next);
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`[data-side="${next}"]`)
      ?.focus();
  };
  return (
    <div className="grid h-full content-center gap-4 px-1">
      <h2 id={headingId} className="text-center text-[15px] font-semibold text-fg">
        Review this game as
      </h2>
      <div role="radiogroup" aria-labelledby={headingId} className="grid grid-cols-2 gap-2.5">
        {options.map((option) => {
          const checked = option.color === side;
          const label = option.color === "white" ? "White" : "Black";
          return (
            <button
              key={option.color}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={`${label} (${option.name})`}
              data-side={option.color}
              tabIndex={checked ? 0 : -1}
              onKeyDown={onRadioKeyDown}
              className={cn(
                "grid min-w-0 justify-items-center gap-2.5 rounded-xl border px-2.5 pt-4 pb-3.5 text-sm transition-colors duration-micro focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
                checked
                  ? "border-accent/60 bg-accent-soft text-fg"
                  : "border-line bg-surface text-fg-secondary hover:border-line-strong"
              )}
              onClick={() => pick(option.color)}
            >
              <span
                aria-hidden
                className="grid size-16 place-items-center rounded-[15px] shadow-[0_6px_16px_-8px_rgb(0_0_0/0.7)]"
                style={{ backgroundColor: option.square }}
              >
                <PieceArt color={option.color} piece="king" className="size-13" />
              </span>
              <span className="grid min-w-0 max-w-full justify-items-center gap-0.5">
                <span className="font-semibold text-fg">{label}</span>
                <span className="max-w-full truncate text-xs text-fg-muted">{option.name}</span>
              </span>
            </button>
          );
        })}
      </div>
      <Button
        type="button"
        variant="primary"
        className="h-10 w-full font-semibold"
        disabled={!onStart}
        onClick={() => onStart?.(side)}
      >
        <Play />
        Start review
      </Button>
    </div>
  );
}
