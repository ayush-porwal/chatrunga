import { memo, type ReactNode } from "react";
import { SideDot } from "@/components/ui/side-dot";
import type { EngineIdentity } from "@/lib/engine-identity";
import { cn } from "@/lib/utils";
import { EngineAvatar } from "../analysis/EngineAvatar";
import { useYourPicture, YourAvatar } from "../profile/YourAvatar";
import { sideMark } from "../profile/side-mark";

/**
 * Player label next to a board: the side's tile (the engine's image slot, your picture on your
 * side, else a side dot on a rounded square), name, optional Elo and hint. Shared by the game
 * board (BoardView) and the game review board via <PlayerRow> so both read the same.
 */
function PlayerIdentity({
  color,
  name,
  elo,
  engine = null,
  you = false,
  hint = null,
  className
}: {
  color: "white" | "black";
  name: string;
  elo?: string | null;
  /** When the side is played by an engine: its image slot (EngineAvatar) instead of the side dot. */
  engine?: EngineIdentity | null;
  /** The side is yours: your picture (when you have one) instead of the side dot. */
  you?: boolean;
  hint?: ReactNode;
  className?: string;
}) {
  const yours = useYourPicture();
  const mark = sideMark(engine, you ? yours : null);
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5 text-sm", className)}>
      {mark.kind === "engine" ? (
        <EngineAvatar engine={mark.engine} size="sm" />
      ) : mark.kind === "you" ? (
        <YourAvatar picture={mark.picture} size="sm" />
      ) : (
        <span
          aria-hidden="true"
          className="grid size-6 shrink-0 place-items-center rounded-[7px] bg-control"
        >
          <SideDot color={color} className="size-[11px]" />
        </span>
      )}
      <span className="truncate font-semibold text-fg">{name}</span>
      {elo ? (
        <span className="shrink-0 text-[0.8125rem] text-fg-subtle tabular-nums">{elo}</span>
      ) : null}
      {hint ? <span className="shrink-0 truncate text-xs text-fg-subtle">{hint}</span> : null}
    </div>
  );
}

/**
 * The clock box beside a player row: a quiet sunken box, lit (the light side box) for the side to
 * move (`active`). Fixed minimum width and tabular digits so the text never shifts as it counts;
 * `low` (little time left) turns the time red; `running` marks a clock counting down.
 */
export function ClockFace({
  color,
  text,
  active = false,
  low = false,
  running = false
}: {
  color: "white" | "black";
  text: string;
  active?: boolean;
  low?: boolean;
  running?: boolean;
}) {
  return (
    <div
      role="timer"
      aria-label={`${color === "white" ? "White" : "Black"} clock`}
      data-running={running ? "true" : undefined}
      className={cn(
        "grid h-7.5 min-w-[4.75rem] place-items-center rounded-lg border px-2.5 font-mono text-[0.9375rem] leading-none font-semibold tabular-nums",
        "transition-[background-color,border-color,color] duration-standard ease-standard",
        active
          ? "border-transparent bg-side-white text-side-white-fg"
          : "border-line bg-surface-sunken text-fg-muted",
        low && (active ? "text-mark-blunder" : "text-danger")
      )}
    >
      {text}
    </div>
  );
}

/**
 * One player row above/below the board: identity on the left, clock on the right when there is one.
 * Fixed height whether or not a clock is shown, so the board never shifts between modes.
 * `clock` is a PGN clock string or a ready clock element (the live <EngineClock>).
 */
export const PlayerRow = memo(function PlayerRow({
  color,
  name,
  elo = null,
  engine = null,
  you = false,
  hint = null,
  clock = null,
  clockActive = false
}: {
  color: "white" | "black";
  name: string;
  elo?: string | null;
  engine?: EngineIdentity | null;
  you?: boolean;
  hint?: ReactNode;
  clock?: ReactNode;
  clockActive?: boolean;
}) {
  return (
    <div className="flex h-8 w-full min-w-0 items-center justify-between gap-3 px-0.5">
      <PlayerIdentity color={color} name={name} elo={elo} engine={engine} you={you} hint={hint} />
      {typeof clock === "string" ? (
        clock ? (
          <ClockFace color={color} text={clock} active={clockActive} />
        ) : null
      ) : (
        clock
      )}
    </div>
  );
});
