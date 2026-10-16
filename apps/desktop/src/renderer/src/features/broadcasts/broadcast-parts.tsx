import { memo, useState, type ReactNode } from "react";
import { Bell, BellRing, ImageIcon } from "lucide-react";
import type { BroadcastPlayer } from "@chaturanga/shared/types/broadcast";
import { formatEngineScore } from "@chaturanga/shared/chess/review";
import type { Color } from "@chaturanga/shared/types/chess";
import type { EngineScore } from "@chaturanga/shared/types/engine";
import { cn } from "@/lib/utils";
import { useBroadcastStore } from "../../stores/broadcast-store";
import { evalShare } from "../board/EvalBar";
import { BoardThumbnail } from "../settings/board-thumbnail";
import { clockNowMs, clockText, isLive, LOW_TIME_MS, type BoardModel } from "./board-state";
import { playerLabel, resultText } from "./broadcast-text";
import { moveFocusInGrid } from "./grid-keys";

/** The red "Live" pill (a dot and its text). */
export function LiveBadge({
  children = "Live",
  className
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-md bg-danger-soft px-2 text-2xs font-semibold text-danger",
        className
      )}
    >
      <LiveDot pulse />
      {children}
    </span>
  );
}

/** The red dot of something live; `pulse` rings it (kept for a few prominent ones, not lists). */
export function LiveDot({ pulse = false, className }: { pulse?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("relative size-1.5 shrink-0 rounded-full bg-danger", className)}
    >
      {pulse ? (
        <span className="absolute inset-0 animate-live-ping rounded-full bg-danger motion-reduce:hidden" />
      ) : null}
    </span>
  );
}

/** A tournament's banner, or a quiet checkered tile when it has none (or it fails to load). */
export function TourImage({
  src,
  className,
  children
}: {
  src: string | null;
  className?: string;
  /** Laid over the image (a badge). */
  children?: ReactNode;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const shown = src && failed !== src ? src : null;
  return (
    <div
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden bg-surface-raised",
        !shown &&
          "bg-[repeating-conic-gradient(var(--color-control)_0_25%,transparent_0_50%)] bg-size-[20px_20px]",
        className
      )}
    >
      {shown ? (
        <img
          src={shown}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full object-cover"
          onError={() => setFailed(shown)}
        />
      ) : (
        <ImageIcon aria-hidden="true" className="size-5 text-fg-subtle" />
      )}
      {children}
    </div>
  );
}

/** A player's title, name and rating in one line. */
export function PlayerLine({
  player,
  color,
  dim = false,
  size = "md",
  className
}: {
  player: BroadcastPlayer;
  color?: Color;
  dim?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
      {color ? (
        <span
          aria-hidden="true"
          className={cn(
            "size-2.25 shrink-0 rounded-full",
            color === "white" ? "bg-piece-white" : "border border-line-strong bg-piece-black"
          )}
        />
      ) : null}
      {player.title ? (
        <span className="shrink-0 text-2xs font-semibold text-warn">{player.title}</span>
      ) : null}
      <span
        className={cn(
          "truncate font-semibold",
          size === "sm" ? "text-[0.78125rem]" : "text-[0.8125rem]",
          dim ? "text-fg-subtle" : "text-fg"
        )}
      >
        {player.name}
      </span>
      {player.rating ? (
        <span className="shrink-0 text-2xs text-fg-subtle tabular-nums">{player.rating}</span>
      ) : null}
    </span>
  );
}

function ClockBox({ board, color, now }: { board: BoardModel; color: Color; now: number }) {
  const ms = clockNowMs(board, color, now);
  if (ms === null) return null;
  const live = isLive(board);
  const active = live && board.sideToMove === color;
  const low = live && ms < LOW_TIME_MS;
  return (
    <span
      role="timer"
      aria-label={`${color === "white" ? "White" : "Black"} clock`}
      className={cn(
        "grid h-5.5 min-w-14 shrink-0 place-items-center rounded-md border px-1.5 font-mono text-[0.71875rem] font-semibold tabular-nums",
        active
          ? "border-transparent bg-side-white text-side-white-fg"
          : live
            ? "border-line bg-surface-sunken text-fg-muted"
            : "border-line-subtle bg-surface-sunken text-fg-subtle",
        low && (active ? "text-mark-blunder" : "text-danger")
      )}
    >
      {clockText(ms)}
    </span>
  );
}

/**
 * A board of a round: both players with their clocks (the side to move's lit and running), the
 * position with its last move, and the board number with its state. Opens the game; a live one
 * has a bell for a notification when it ends.
 */
export const BoardCard = memo(function BoardCard({
  board,
  number,
  roundId,
  now,
  highlighted,
  evaluation,
  onOpen
}: {
  board: BoardModel;
  number: number;
  roundId: string;
  now: number;
  /** The board a search picked: outlined until another is opened. */
  highlighted: boolean;
  /** The engine's look at the position (`score` null: on its way, or none); absent: not shown. */
  evaluation?: { score: EngineScore | null };
  onOpen: (gameId: string) => void;
}) {
  const live = isLive(board);
  const whiteLost = board.result === "0-1";
  const blackLost = board.result === "1-0";
  const low =
    live && (clockNowMs(board, board.sideToMove, now) ?? Number.POSITIVE_INFINITY) < LOW_TIME_MS;
  return (
    <div
      data-grid-card
      className={cn(
        "group relative grid min-w-0 gap-1 rounded-[10px] border bg-surface p-2 transition-[border-color,box-shadow,translate] duration-standard ease-enter",
        "hover:-translate-y-0.5 hover:border-accent hover:shadow-[0_8px_20px_-10px_rgb(0_0_0/0.5)] has-[>button:active]:translate-y-0 has-[>button:focus-visible]:ring-2 has-[>button:focus-visible]:ring-accent/70",
        highlighted ? "border-accent shadow-[0_0_0_3px_rgb(143_182_111/0.18)]" : "border-line"
      )}
    >
      {/* The whole card opens the game (the button's ::after covers it); the bell sits above. */}
      <button
        type="button"
        onClick={() => onOpen(board.id)}
        // The arrow keys move between the grid's boards (Enter opens one).
        onKeyDown={moveFocusInGrid}
        aria-label={`Board ${number}: ${playerLabel(board.white)} against ${playerLabel(board.black)}, ${resultText(board.result)}. Open in analysis.`}
        className="grid min-w-0 gap-1 text-left outline-none after:absolute after:inset-0 after:rounded-[10px]"
      >
        <span className="flex h-6.5 min-w-0 items-center justify-between gap-1.5">
          <PlayerLine player={board.black} dim={blackLost} size="sm" />
          <ClockBox board={board} color="black" now={now} />
        </span>
        <BoardThumbnail fen={board.fen} lastMove={board.lastMove} rounded="md" />
        {evaluation ? <EvalStrip score={evaluation.score} /> : null}
        <span className="flex h-6.5 min-w-0 items-center justify-between gap-1.5">
          <PlayerLine player={board.white} dim={whiteLost} size="sm" />
          <ClockBox board={board} color="white" now={now} />
        </span>
      </button>
      <span className="flex h-5.5 items-center justify-between gap-1.5 border-t border-line-subtle px-0.5 pt-0.5 text-2xs text-fg-subtle">
        <span>Board {number}</span>
        <span className="flex-1" />
        {live ? <AlertBell board={board} number={number} roundId={roundId} /> : null}
        {live ? (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[5px] px-1.5 font-semibold text-danger",
              low && "bg-danger-soft"
            )}
          >
            <LiveDot />
            {low ? "Time trouble" : "Live"}
          </span>
        ) : (
          <span className="rounded-[5px] bg-control px-1.5 font-semibold text-fg">
            {resultText(board.result)}
          </span>
        )}
      </span>
    </div>
  );
});

/** A card's evaluation: White's share of a thin bar, and the score (pulsing while on its way). */
function EvalStrip({ score }: { score: EngineScore | null }) {
  return (
    <span
      role="img"
      aria-label={score ? `Evaluation ${formatEngineScore(score)}` : "Evaluating"}
      className="flex h-3.5 items-center gap-1.5"
    >
      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-piece-black ring-1 ring-line-strong">
        <span
          className={cn(
            "block h-full bg-piece-white transition-[width] duration-emphasis ease-standard",
            !score && "animate-pulse opacity-40"
          )}
          style={{ width: `${score ? evalShare(score) : 50}%` }}
        />
      </span>
      <span className="w-10 shrink-0 text-right font-mono text-2xs text-fg-muted tabular-nums">
        {score ? formatEngineScore(score) : ""}
      </span>
    </span>
  );
}

/** A live board's bell: a desktop notification when its game ends (on, it stays lit). */
export function AlertBell({
  board,
  number,
  roundId,
  className
}: {
  board: Pick<BoardModel, "id" | "white" | "black">;
  number?: number;
  roundId: string;
  className?: string;
}) {
  const on = useBroadcastStore((state) => state.alerts[board.id] !== undefined);
  const setAlert = useBroadcastStore((state) => state.setAlert);
  const what = number === undefined ? "this game" : `board ${number}`;
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? `Don't notify me when ${what} ends` : `Notify me when ${what} ends`}
      title={on ? "You'll be notified when it ends" : "Notify me when it ends"}
      onClick={() =>
        setAlert(
          board.id,
          on ? null : { roundId, white: playerLabel(board.white), black: playerLabel(board.black) }
        )
      }
      className={cn(
        "relative z-10 grid size-5 place-items-center rounded-[5px] outline-none transition-[color,opacity,background-color] hover:bg-control focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/70",
        on ? "text-accent" : "text-fg-subtle opacity-0 group-hover:opacity-100 hover:text-fg",
        className
      )}
    >
      {on ? (
        <BellRing aria-hidden="true" className="size-3.25" />
      ) : (
        <Bell aria-hidden="true" className="size-3.25" />
      )}
    </button>
  );
}
