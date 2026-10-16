import { useEffect } from "react";
import { BookmarkPlus, Radio, Undo2 } from "lucide-react";
import type { BroadcastRoundDetail } from "@chaturanga/shared/types/broadcast";
import { formatMillisecondsClock } from "@chaturanga/shared/chess/clock-display";
import { clocksOnPathToNode } from "@chaturanga/shared/chess/pgn";
import type { Color, MoveNode } from "@chaturanga/shared/types/chess";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Select } from "@/components/ui/input";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { isTyping, OVERLAY_SELECTOR } from "../../app/useBoardShortcuts";
import { useSaveGameMutation } from "../../queries/api";
import { useBroadcastRoundQuery } from "../../queries/broadcasts";
import { useAppNoticeStore } from "../../stores/app-notice-store";
import { useBroadcastStore, type BroadcastFollow } from "../../stores/broadcast-store";
import { useGameStore } from "../../stores/game-store";
import { ClockFace } from "../board/PlayerIdentity";
import { BoardThumbnail } from "../settings/board-thumbnail";
import { backToLive, followedCopy, undoBackToLive } from "./broadcast-follow";
import { AlertBell, LiveDot } from "./broadcast-parts";
import { elapsedText, resultText } from "./broadcast-text";
import { clockToMs, LOW_TIME_MS, useSecondClock } from "./board-state";
import { ownMoveCount } from "./live-line";

/** The key that goes back to the live position. */
const BACK_TO_LIVE_KEY = "L";

function movesText(count: number): string {
  return count === 1 ? "1 move" : `${count} moves`;
}

/** A move as the move list numbers it ("19… h6"), or "the start" before any. */
function moveLabel(node: MoveNode | undefined): string {
  if (!node?.san) return "the start";
  const white = node.ply % 2 === 1;
  return `${Math.ceil(node.ply / 2)}${white ? "." : "…"} ${node.san}`;
}

/** L goes back to live while the board is away from it (not while typing or in a dialog). */
function useBackToLiveKey(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toUpperCase() !== BACK_TO_LIVE_KEY) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat) return;
      if (isTyping(event.target) || document.querySelector(OVERLAY_SELECTOR)) return;
      event.preventDefault();
      backToLive();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}

/**
 * The Moves tab's live strip for a followed broadcast game: following the live position, or
 * exploring away from it with the live position beside "Back to live" (which clears the user's
 * own moves; Undo puts them back). Nothing for any other board.
 */
export function BroadcastLivePanel({
  onOpenGame
}: {
  /** Another game of the round on the board (the switcher). */
  onOpenGame?: (detail: BroadcastRoundDetail, gameId: string) => void;
}) {
  const follow = useBroadcastStore((state) => state.follow);
  const board = useGameStore((state) => state.board);
  const moveTree = useGameStore((state) => state.moveTree);
  const currentNodeId = useGameStore((state) => state.currentNodeId);
  const followed = follow?.board === board ? follow : null;
  const liveTip = followed?.liveIds.at(-1) ?? "root";
  const own = followed ? ownMoveCount(moveTree, followed.liveIds) : 0;
  const exploring = followed !== null && (currentNodeId !== liveTip || own > 0);
  useBackToLiveKey(exploring);

  if (!followed) return null;
  const tipNode = moveTree.find((node) => node.id === liveTip);
  return (
    <>
      <GameBar follow={followed} onOpenGame={onOpenGame} />
      {exploring ? (
        <ExploringStrip
          follow={followed}
          tipNode={tipNode}
          startFen={moveTree.at(0)?.fenAfter ?? ""}
          own={own}
        />
      ) : (
        <FollowingStrip follow={followed} tipFen={tipNode?.fenAfter ?? null} />
      )}
    </>
  );
}

/**
 * Over the strip: the round's other games, to switch to (each followed in turn), and a copy of
 * this one for the library (the board goes on following).
 */
function GameBar({
  follow,
  onOpenGame
}: {
  follow: BroadcastFollow;
  onOpenGame?: (detail: BroadcastRoundDetail, gameId: string) => void;
}) {
  const round = useBroadcastRoundQuery(follow.roundId);
  const streamed = useBroadcastStore((state) => state.games);
  const save = useSaveGameMutation();
  const detail = round.data;
  const saveCopy = () => {
    const copy = followedCopy();
    if (!copy) return;
    const notices = useAppNoticeStore.getState();
    save.mutateAsync(copy).then(
      () => notices.show("Saved a copy to your library.", { tone: "success" }),
      (error: unknown) => notices.show(`Couldn't save a copy: ${ipcErrorMessage(error)}`)
    );
  };
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line-subtle px-3">
      {detail && onOpenGame ? (
        <Select
          aria-label="Switch to another game of the round"
          value={follow.gameId}
          onChange={(event) => onOpenGame(detail, event.target.value)}
          className="h-7 min-w-0 flex-1 text-xs"
        >
          {detail.games.map((game, index) => (
            <option key={game.id} value={game.id}>
              Board {index + 1} · {game.white.name} – {game.black.name} ·{" "}
              {resultText(streamed[game.id]?.result ?? game.result)}
            </option>
          ))}
        </Select>
      ) : (
        <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">{follow.tourName}</span>
      )}
      <IconButton
        label="Save a copy to the library"
        icon={<BookmarkPlus />}
        size="icon-xs"
        disabled={save.isPending}
        onClick={saveCopy}
      />
    </div>
  );
}

/** On the live position: following it (how long the side to move has thought), or its result. */
function FollowingStrip({ follow, tipFen }: { follow: BroadcastFollow; tipFen: string | null }) {
  const cleared = useBroadcastStore((state) => state.cleared);
  const game = useBroadcastStore((state) => state.games[follow.gameId]);
  const lastMoveAt = game?.lastMoveAt ?? null;
  const connection = useBroadcastStore((state) => state.connections[follow.roundId] ?? null);
  const over = follow.result !== "*";
  return (
    <div
      role="status"
      className="flex h-11 shrink-0 items-center gap-2.5 border-b border-line-subtle px-4 text-[0.8125rem]"
    >
      {over ? (
        <span className="rounded-md bg-control px-1.5 text-xs font-bold text-fg">
          {resultText(follow.result)}
        </span>
      ) : (
        <LiveDot
          pulse
          className="size-2 shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-danger)_18%,transparent)]"
        />
      )}
      <span className="font-semibold text-fg">{over ? "Game over" : "Following live"}</span>
      <span className="truncate text-fg-subtle">{follow.roundName}</span>
      <span className="flex-1" />
      {over ? null : connection ? (
        <span className="shrink-0 text-xs text-warn">
          {connection.retrying ? "Reconnecting…" : "Live updates stopped"}
        </span>
      ) : (
        <ThinkingTime lastMoveAt={lastMoveAt} fen={tipFen} />
      )}
      {over || !game ? null : (
        <AlertBell board={game} roundId={follow.roundId} className="size-6 opacity-100" />
      )}
      {cleared ? (
        <Button size="xs" onClick={undoBackToLive}>
          <Undo2 />
          Undo
        </Button>
      ) : null}
    </div>
  );
}

/** Away from the live position: where the game is now, and the way back to it. */
function ExploringStrip({
  follow,
  tipNode,
  startFen,
  own
}: {
  follow: BroadcastFollow;
  tipNode: MoveNode | undefined;
  startFen: string;
  own: number;
}) {
  const over = follow.result !== "*";
  const liveAt = moveLabel(tipNode);
  return (
    <div className="grid shrink-0 gap-2.5 border-b border-line-subtle bg-surface-raised px-3 py-3">
      <div className="flex items-center gap-3">
        <span className="w-[72px] shrink-0">
          <BoardThumbnail
            fen={tipNode?.fenAfter ?? startFen}
            lastMove={tipNode?.uci ?? null}
            rounded="md"
            label={`Live position after ${liveAt}`}
          />
        </span>
        <div className="grid min-w-0 gap-0.5">
          <span className="text-[0.8125rem] font-semibold text-fg">
            {own > 0 ? "You’re exploring your own line" : "You’re looking at an earlier move"}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-fg-muted">
            {over ? (
              <span className="font-semibold text-fg">{resultText(follow.result)}</span>
            ) : (
              <LiveDot />
            )}
            {over ? `Game over after ${liveAt}` : `Live is at ${liveAt}`}
          </span>
          {own > 0 ? (
            <span className="text-xs text-fg-subtle">{movesText(own)} of yours on the board</span>
          ) : null}
        </div>
      </div>
      <Button
        variant="primary"
        size="sm"
        className="justify-start"
        aria-keyshortcuts={BACK_TO_LIVE_KEY}
        onClick={() => backToLive()}
      >
        <Radio />
        {over ? "Back to the final position" : "Back to live"}
        {own > 0 ? (
          <span className="font-normal text-accent-fg/70">· clears your {movesText(own)}</span>
        ) : null}
        <span className="ml-auto rounded-[4px] border border-accent/35 px-1.5 text-2xs font-medium">
          {BACK_TO_LIVE_KEY}
        </span>
      </Button>
    </div>
  );
}

/** "White thinking 3:12": how long the side to move has been thinking, when known. */
function ThinkingTime({ lastMoveAt, fen }: { lastMoveAt: number | null; fen: string | null }) {
  const now = useSecondClock();
  if (lastMoveAt === null || !fen) return null;
  const side = fen.split(" ")[1] === "b" ? "Black" : "White";
  const seconds = Math.max(0, Math.floor((now - lastMoveAt) / 1000));
  const text =
    seconds < 3600
      ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
      : elapsedText(lastMoveAt, now);
  return (
    <span className="shrink-0 text-xs text-fg-muted tabular-nums">
      {side} thinking {text}
    </span>
  );
}

/**
 * The board's clock for the side to move on a followed game's live position: its time at the last
 * move, running since that move arrived. Without both, the time as of the last move.
 */
export function BroadcastClock({ color, fallback }: { color: Color; fallback: string }) {
  const now = useSecondClock();
  const lastMoveAt = useBroadcastStore((state) =>
    state.follow ? (state.games[state.follow.gameId]?.lastMoveAt ?? null) : null
  );
  const tip = useBroadcastStore((state) => state.follow?.liveIds.at(-1) ?? "root");
  const moveTree = useGameStore((state) => state.moveTree);
  const clockMs = clockToMs(clocksOnPathToNode(moveTree, tip)[color]);
  if (clockMs === null || lastMoveAt === null)
    return <ClockFace color={color} text={fallback} active />;
  const left = Math.max(0, clockMs - (now - lastMoveAt));
  return (
    <ClockFace
      color={color}
      text={formatMillisecondsClock(left)}
      active
      running
      low={left < LOW_TIME_MS}
    />
  );
}
