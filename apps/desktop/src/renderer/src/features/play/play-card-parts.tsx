import type { ReactNode } from "react";
import { ArrowLeftRight, Bot, Info, Loader2, X } from "lucide-react";
import type { Color } from "@chaturanga/shared/types/chess";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { EngineIdentity } from "@/lib/engine-identity";
import { cn } from "@/lib/utils";
import type { PreviewPieceRole } from "../settings/piece-style-preview";
import { EngineAvatar } from "../analysis/EngineAvatar";
import { PieceArt, useBoardSquareColors } from "./piece-art";
import { formatElapsed } from "./time-control";

/* ------------------------------------------------------------------ tiles */

/** You: a king on a board square in your colour (light king on a dark square), split for random. */
export function KingTile({ color }: { color: Color | "random" }) {
  const squares = useBoardSquareColors();
  if (color === "random") {
    return (
      <span
        className="play-tile"
        data-kind="split"
        style={{ background: `linear-gradient(90deg, ${squares.dark} 50%, ${squares.light} 50%)` }}
      >
        <PieceArt color="white" piece="king" className="play-tile-piece" />
        <PieceArt color="black" piece="king" className="play-tile-piece" />
      </span>
    );
  }
  return (
    <span
      className="play-tile"
      style={{ background: color === "white" ? squares.dark : squares.light }}
    >
      <PieceArt color={color} piece="king" className="play-tile-piece" />
    </span>
  );
}

/**
 * The opponent: an engine (its image slot: its picture, logo or monogram), a Lichess opponent
 * (neutral tile with an icon), or nobody yet (dashed). `side` puts the opponent's colour on the
 * corner.
 */
export function OpponentTile({
  kind,
  icon,
  engine,
  side
}: {
  kind: "engine" | "online" | "empty";
  /** The online and empty tiles' icon. */
  icon?: ReactNode;
  /** The engine, for its picture. */
  engine?: EngineIdentity | null;
  side?: Color | null;
}) {
  return (
    <span className="play-tile" data-kind={kind}>
      {kind === "engine" ? <EngineAvatar engine={engine} size="fill" /> : icon}
      {side ? (
        <i
          className={cn("play-tile-dot", side === "white" ? "bg-piece-white" : "bg-piece-black")}
          aria-hidden="true"
        />
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------------ header */

/** One side of the header: its tile, then its name (or the friend's username field) and detail. */
export function MatchSide({
  tile,
  name,
  detail
}: {
  tile: ReactNode;
  /** Text, or a field in its place. */
  name: ReactNode;
  /** The small line under the name; left out of a bare header. */
  detail?: ReactNode;
}) {
  return (
    <div className="relative grid min-w-0 justify-items-center gap-px text-center">
      {tile}
      {typeof name === "string" ? (
        <b className="mt-2.5 inline-flex max-w-full text-[0.9375rem] font-semibold text-fg">
          <span className="truncate">{name}</span>
        </b>
      ) : (
        name
      )}
      {detail === undefined ? null : (
        <small className="min-h-[1.45em] max-w-full truncate text-[0.71875rem] tabular-nums text-fg-subtle">
          {detail}
        </small>
      )}
    </div>
  );
}

/**
 * You vs the opponent: takes the card's spare height and sizes its tiles to it (play.css). Between
 * the sides, the swap button where you choose your colour, else a static "VS". `bare`: neither
 * side has a detail line, so the tiles may use that height too.
 */
export function Matchup({
  you,
  opponent,
  onSwap,
  swapDisabled,
  bare,
  locked
}: {
  you: ReactNode;
  opponent: ReactNode;
  /** Null: a "VS" instead of the swap button. */
  onSwap: (() => void) | null;
  swapDisabled?: boolean;
  bare: boolean;
  /** A Lichess game is live: shown dimmed, not usable. */
  locked: boolean;
}) {
  return (
    <div
      className={cn("play-match-wrap", locked && "pointer-events-none opacity-40")}
      data-bare={bare ? "" : undefined}
      inert={locked}
    >
      <div className="play-match">
        {you}
        {onSwap ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="play-swap"
                aria-label="Switch colours"
                disabled={swapDisabled}
                onClick={onSwap}
              >
                <ArrowLeftRight aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Switch colours</TooltipContent>
          </Tooltip>
        ) : (
          <span className="play-vs" aria-hidden="true">
            <i />
            <b>VS</b>
          </span>
        )}
        {opponent}
      </div>
    </div>
  );
}

/** Nobody to play yet: the dashed tile and "No opponent". */
export function NoOpponentSide() {
  return (
    <MatchSide
      tile={<OpponentTile kind="empty" icon={<Bot aria-hidden="true" />} />}
      name="No opponent"
      detail=""
    />
  );
}

/* ------------------------------------------------------------------ ways to play */

/**
 * A way to get an opponent (first run, or a mode that can't be used yet): a piece on a board
 * square with a badge, its name, and its action (or its progress).
 */
export function WayRow({
  piece,
  square,
  badge,
  badgeBob = false,
  title,
  detail,
  action
}: {
  piece: { color: Color; role: PreviewPieceRole };
  square: "light" | "dark";
  badge: ReactNode;
  /** The download badge nods now and then (play.css). */
  badgeBob?: boolean;
  title: string;
  detail?: ReactNode;
  action: ReactNode;
}) {
  const squares = useBoardSquareColors();
  return (
    <div className="group/way flex items-center gap-3.5 rounded-xl border border-line bg-surface-sunken p-3 transition-colors duration-standard ease-standard hover:border-line-strong hover:bg-control">
      <span
        className="relative grid size-13 shrink-0 place-items-center rounded-[13px]"
        style={{ background: square === "dark" ? squares.dark : squares.light }}
      >
        <PieceArt color={piece.color} piece={piece.role} className="size-10.5" />
        <span
          aria-hidden="true"
          className={cn(
            "absolute -bottom-1.5 -right-1.5 grid size-6 place-items-center rounded-full bg-control-hover text-fg shadow-[0_0_0_3px_var(--color-surface-sunken)] transition-shadow duration-standard group-hover/way:shadow-[0_0_0_3px_var(--color-control)] [&>svg]:size-3.25 [&>svg]:stroke-[2.4]",
            badgeBob && "play-way-badge-bob"
          )}
        >
          {badge}
        </span>
      </span>
      <span className="grid min-w-0 flex-1">
        <b className="text-sm font-semibold text-fg">{title}</b>
        {detail ? <small className="truncate text-xs text-fg-subtle">{detail}</small> : null}
      </span>
      {action}
    </div>
  );
}

/** A way row's button: primary, small, the same width in every row. */
export const wayButton =
  "h-7.5 min-w-[9.375rem] rounded-[7px] px-2.75 text-[0.8125rem] font-normal [&_svg]:size-3.75";

/* ------------------------------------------------------------------ footer */

/** The footer's primary button: full width, level with the board cards' buttons. */
export const footButton = "h-8.5 w-full font-normal [&_svg]:size-3.75";

/**
 * Finding an opponent / waiting for a friend: the whole bar is the Cancel button. It shows the
 * search and its time; hovered or focused, it turns danger and says Cancel.
 */
export function WaitBar({
  label,
  seconds,
  onCancel
}: {
  label: string;
  seconds: number;
  onCancel: () => void;
}) {
  const time = formatElapsed(seconds);
  return (
    <button
      type="button"
      className="play-wait"
      aria-label={`${label} ${time}. Cancel`}
      onClick={onCancel}
    >
      <span className="play-wait-on">
        <Loader2
          className="size-4.5 shrink-0 animate-spin text-accent motion-reduce:animate-none"
          aria-hidden="true"
        />
        <b>{label}</b>
        <span className="tabular-nums text-fg-muted">{time}</span>
      </span>
      <span className="play-wait-off">
        <X className="size-4 shrink-0" aria-hidden="true" />
        <b>Cancel</b>
      </span>
    </button>
  );
}

/** A Lichess game owns the board: why the setup above is dimmed. */
export function LiveGameNote() {
  return (
    <div
      role="status"
      className="flex min-h-8.5 items-center gap-2.5 rounded-lg border border-info/20 bg-info-soft px-3 py-1.5"
    >
      <Info className="size-4 shrink-0 text-info" aria-hidden="true" />
      <span className="grid min-w-0 flex-1 leading-[1.3]">
        <b className="text-[0.8125rem] font-medium text-fg">You have a game in progress</b>
        <span className="text-xs text-fg-muted">Finish it before starting another one.</span>
      </span>
    </div>
  );
}

/** One failed call (seek, challenge, AI game, a handoff), as one quiet line. */
export function ErrorLine({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="animate-rise-in text-xs leading-5 text-danger">
      {children}
    </p>
  );
}

/** Rated / Casual and the AI levels: the app's segmented control at the mock's size. */
export const playSegClass =
  "rounded-[9px] p-[3px] [&>span]:inset-y-[3px] [&_[data-segment]]:font-normal [&_[data-segment]]:text-[0.8125rem]";

/** The accent variant (the Lichess AI's level). */
export const playSegAccentClass =
  "[&>span]:bg-accent-soft [&>span]:shadow-[inset_0_0_0_1px_rgb(143_182_111/0.35)] [&_[aria-checked=true]]:text-accent-fg";
