import { memo, type ReactNode } from "react";
import { Cpu } from "lucide-react";
import { SideDot } from "@/components/ui/side-dot";
import { cn } from "@/lib/utils";
import { localImageSrc } from "@/lib/local-image";

/**
 * Player label next to a board: side swatch (or the engine's logo), name, optional Elo tag and hint.
 * Shared by the game board (BoardView) and the game review board via <PlayerRow> so both read the same.
 */
export function PlayerIdentity({
  color,
  name,
  elo,
  engine = null,
  hint = null,
  className
}: {
  color: "white" | "black";
  name: string;
  elo?: string | null;
  /** When the side is played by an engine: shows its logo (or a CPU glyph) instead of the plain side dot. */
  engine?: { imagePath: string | null } | null;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2 text-sm", className)}>
      {engine ? <EngineSwatch color={color} imagePath={engine.imagePath} /> : <SideDot color={color} size="md" />}
      <span className="truncate font-medium text-fg-secondary">{name}</span>
      {elo ? (
        <span className="shrink-0 rounded-md border border-line px-1 font-mono text-2xs text-fg-muted tabular-nums">{elo}</span>
      ) : null}
      {hint ? <span className="shrink-0 truncate text-xs text-fg-subtle">{hint}</span> : null}
    </div>
  );
}

function EngineSwatch({ color, imagePath }: { color: "white" | "black"; imagePath: string | null }) {
  const src = localImageSrc(imagePath);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 [&_svg]:size-2.5",
        color === "white" ? "bg-piece-white text-piece-black ring-black/40" : "bg-piece-black text-fg ring-white/20"
      )}
    >
      {src ? <img className="h-full w-full object-cover" src={src} alt="" /> : <Cpu />}
    </span>
  );
}

/**
 * The clock box beside a player row. Fixed minimum width and tabular digits so the text never
 * shifts as it counts; `low` (little time left) turns it red and, while it runs, pulses gently.
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
        "min-w-[4.75rem] rounded-md border px-2 py-0.5 text-right text-base font-semibold tabular-nums",
        "transition-[background-color,border-color,color] duration-standard ease-standard",
        low
          ? cn("board-clock-low border-danger/60 text-danger", active ? "bg-danger-soft" : "bg-surface-sunken")
          : active
            ? "border-accent/50 bg-accent-soft text-fg"
            : "border-line bg-surface-sunken text-fg-muted"
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
  hint = null,
  clock = null,
  clockActive = false
}: {
  color: "white" | "black";
  name: string;
  elo?: string | null;
  engine?: { imagePath: string | null } | null;
  hint?: ReactNode;
  clock?: ReactNode;
  clockActive?: boolean;
}) {
  return (
    <div className="flex h-8 w-full min-w-0 items-center justify-between gap-3 px-0.5">
      <PlayerIdentity color={color} name={name} elo={elo} engine={engine} hint={hint} />
      {typeof clock === "string" ? clock ? <ClockFace color={color} text={clock} active={clockActive} /> : null : clock}
    </div>
  );
});
