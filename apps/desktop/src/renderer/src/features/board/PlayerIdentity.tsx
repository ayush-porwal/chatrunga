import type { ReactNode } from "react";
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
 * One player row above/below the board: identity on the left, clock on the right when there is one.
 * Fixed height whether or not a clock is shown, so the board never shifts between modes.
 */
export function PlayerRow({
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
  clock?: string | null;
  clockActive?: boolean;
}) {
  return (
    <div className="flex h-8 w-full min-w-0 items-center justify-between gap-3 px-0.5">
      <PlayerIdentity color={color} name={name} elo={elo} engine={engine} hint={hint} />
      {clock ? (
        <div
          aria-label={`${color === "white" ? "White" : "Black"} clock`}
          className={cn(
            "min-w-16 rounded-md border px-2 py-0.5 text-right text-base font-semibold tabular-nums transition-colors",
            clockActive ? "border-accent/50 bg-accent-soft text-fg" : "border-line bg-surface-sunken text-fg-muted"
          )}
        >
          {clock}
        </div>
      ) : null}
    </div>
  );
}
