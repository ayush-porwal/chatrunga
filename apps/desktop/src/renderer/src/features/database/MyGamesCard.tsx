import { lazy, Suspense, useState } from "react";
import { Pause, Play, RotateCcw, Settings, Sparkles, X } from "lucide-react";
import type { GamePuzzleQueueStatus } from "@chaturanga/shared/types/game-puzzles";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Progress } from "@/components/ui/progress";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { cn } from "@/lib/utils";
import {
  useGamePuzzleQueueMutation,
  useGamePuzzleStatusQuery,
  useGamePuzzleSummaryQuery
} from "../../queries/game-puzzles";
import { GAME_PUZZLES_SET_ID } from "../puzzles/game-puzzle-set";
import { BoardThumbnail } from "../settings/board-thumbnail";
import { useOpenSettings } from "../settings/settings-link";
import { databaseSample } from "./database-card";
import {
  board,
  body,
  cardShell,
  DatabaseCardSkeleton,
  FactsStrip,
  footer,
  titleBar
} from "./DatabaseCard";
import {
  myGamesBlocker,
  myGamesFacts,
  myGamesNote,
  myGamesSourcesLine,
  queueActive,
  queueHeld,
  queueProgress,
  type MyGamesBlocker
} from "./my-games-card";

// The dialog loads when first opened, not with the page.
const GeneratePuzzlesDialog = lazy(() =>
  import("./GeneratePuzzlesDialog").then((module) => ({ default: module.GeneratePuzzlesDialog }))
);

const sample = databaseSample(GAME_PUZZLES_SET_ID);

/**
 * Databases → "My games": puzzles found in the user's own games. Its games per source, how many
 * are processed, the puzzles found and due; the queue's live progress with Pause / Resume and
 * Cancel; Generate puzzles (the dialog) and Train (Puzzles on the "From my games" set). Says why
 * Generate can't run (no games, no connected account, no usable engine) and where to fix it.
 */
export function MyGamesCard({ onTrain }: { onTrain: (setId: string) => void }) {
  const summary = useGamePuzzleSummaryQuery();
  const status = useGamePuzzleStatusQuery();
  const [generating, setGenerating] = useState(false);
  if (summary.isPending) return <DatabaseCardSkeleton />;
  const data = summary.data;
  const blocker = data ? myGamesBlocker(data) : null;
  const sources = data ? myGamesSourcesLine(data) : null;
  const note = myGamesNote(blocker, status.data);

  return (
    <article className={cardShell}>
      <div className={titleBar}>
        <h2 className="min-w-0 truncate text-sm font-semibold text-fg">My games</h2>
        <span className="shrink-0 rounded-full bg-control px-2 py-0.5 text-[0.6875rem] font-semibold text-fg-muted">
          puzzle
        </span>
      </div>

      <div className={body}>
        <BoardThumbnail
          fen={sample.fen}
          orientation={sample.orientation}
          lastMove={sample.lastMove}
          rounded="md"
          className={board}
        />
        <div className="grid min-w-0 flex-1 content-start gap-3">
          <p className="text-[0.78125rem] text-fg-subtle">
            {sources ?? "Lichess, Chess.com and imported games"}
          </p>
          <p className="text-[0.84375rem] leading-normal text-fg-muted">
            Puzzles from your own games, found by Stockfish and Maia 3 on this computer. Each one
            comes back on a spaced-repetition schedule.
          </p>
          {data ? <FactsStrip facts={myGamesFacts(data)} /> : null}
          {summary.isError ? (
            <p className="flex items-center gap-2 text-xs text-danger">
              <span className="min-w-0 flex-1">
                Couldn&apos;t read your games: {ipcErrorMessage(summary.error) || "unknown error"}
              </span>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => void summary.refetch()}
              >
                <RotateCcw />
                Try again
              </Button>
            </p>
          ) : null}
          {note ? <BlockerNote blocker={note} /> : null}
          {status.data && queueActive(status.data) ? <QueueProgress status={status.data} /> : null}
        </div>
      </div>

      <div className={footer}>
        <div className="flex h-10 min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="primary"
            disabled={!data?.puzzles}
            onClick={() => onTrain(GAME_PUZZLES_SET_ID)}
          >
            <Play />
            Train
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!data || blocker !== null}
            onClick={() => setGenerating(true)}
          >
            <Sparkles />
            Generate puzzles
          </Button>
        </div>
      </div>

      {generating && data ? (
        <Suspense fallback={null}>
          <GeneratePuzzlesDialog
            maiaInstalled={data.maiaInstalled}
            onClose={() => setGenerating(false)}
          />
        </Suspense>
      ) : null}
    </article>
  );
}

/** Why Generate puzzles can't run (or the queue stopped), and Open Settings where that is fixed. */
function BlockerNote({ blocker }: { blocker: MyGamesBlocker }) {
  const openSettings = useOpenSettings();
  return (
    <p className="flex items-center gap-2 text-xs leading-5 text-fg-muted">
      <span className="min-w-0 flex-1">{blocker.message}</span>
      {openSettings ? (
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="shrink-0"
          onClick={() => openSettings(blocker.settings)}
        >
          <Settings />
          Open Settings
        </Button>
      ) : null}
    </p>
  );
}

/** The queue's progress: game n of N, the game and its step, Pause / Resume and Cancel. */
function QueueProgress({ status }: { status: GamePuzzleQueueStatus }) {
  const queue = useGamePuzzleQueueMutation();
  const progress = queueProgress(status);
  const held = queueHeld(status);
  return (
    <div className="grid animate-fade-in gap-1.5" role="status">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-xs font-medium tabular-nums text-fg">{progress.headline}</span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <IconButton
            label={held ? "Resume" : "Pause"}
            icon={held ? <Play /> : <Pause />}
            size="icon-xs"
            disabled={queue.isPending}
            onClick={() => queue.mutate(held ? "resume" : "pause")}
          />
          <IconButton
            label="Cancel"
            icon={<X />}
            size="icon-xs"
            disabled={queue.isPending}
            onClick={() => queue.mutate("cancel")}
          />
        </div>
      </div>
      <Progress value={progress.percent} aria-label={progress.headline} />
      <span
        className={cn("truncate text-xs tabular-nums text-fg-muted", !progress.detail && "sr-only")}
        title={progress.detail ?? undefined}
      >
        {progress.detail ?? progress.headline}
      </span>
      {queue.isError ? (
        <span className="text-xs text-danger">
          {ipcErrorMessage(queue.error) || "The queue didn't answer."}
        </span>
      ) : null}
    </div>
  );
}
