/*
 * Following a running review on the board: as each move's analysis finishes, the board steps to
 * it (one step behind the move being analysed), so its mark and BEST line show at once. The user
 * navigating themselves pauses following; resuming jumps to the latest analysed move. Pure (timers
 * aside), so the pacing is tested with fake timers and the hook only wires it to the stores.
 */

/** At most one board step this often: a re-run's cached moves finish almost at once. */
export const FOLLOW_STEP_MS = 250;
/** Further behind than this many moves, the board catches up in one quiet jump. */
export const FOLLOW_MAX_LAG = 2;

/** A board step: `quiet` is a catch-up jump, made without move sounds or sliding pieces. */
export type FollowStep = { nodeId: string; quiet: boolean };

/**
 * Where following puts the board: the index in `line` (the main line's node ids from the start
 * position, `line[0]`) of its latest analysed move, or 0 (the start) before the first.
 */
export function followTargetIndex(
  line: readonly string[],
  analysed: readonly { nodeId: string }[]
): number {
  const done = new Set(analysed.map((move) => move.nodeId));
  for (let index = line.length - 1; index > 0; index -= 1) if (done.has(line[index]!)) return index;
  return 0;
}

/**
 * How a review-store update ends the run being followed (`runId`): "running" while it goes on,
 * "finished" when its own result arrived (setReview keeps the run's id and replaces the review),
 * "stopped" otherwise: cancelled, failed, or detached (an edit took its line off the main line;
 * the store then shows the earlier review again, which must not move the board).
 */
export function runEnding(
  previous: { status: string; reviewId: string | null; review: unknown },
  state: { status: string; reviewId: string | null; review: unknown },
  runId: string
): "running" | "finished" | "stopped" {
  if (state.status === "running" && state.reviewId === runId) return "running";
  const finished =
    previous.status === "running" &&
    state.status === "ready" &&
    state.reviewId === runId &&
    state.review !== previous.review;
  return finished ? "finished" : "stopped";
}

export type AnalysisFollower = {
  /** The run's line and its latest analysed move (followTargetIndex): the board heads there. */
  update: (line: readonly string[], targetIndex: number) => void;
  /**
   * The board changed: to `nodeId`, or a BEST line under it (`browsingLine`). Anything but the
   * follower's own step is the user navigating: following pauses.
   */
  noteBoard: (nodeId: string, browsingLine: boolean) => void;
  /**
   * The user picked a move: following pauses even when the board stays where it is (a click on the
   * move already shown means "hold here").
   */
  pause: () => void;
  /** Follows again, jumping to the latest analysed move. */
  resume: () => void;
  /** The run finished: unless paused, the board goes to its last move. Then it stops following. */
  finish: (lastNodeId: string) => void;
  /** Stops following; pending steps are dropped. */
  dispose: () => void;
  isPaused: () => boolean;
};

export function createAnalysisFollower({
  board: initialBoard,
  show,
  onPausedChange,
  stepMs = FOLLOW_STEP_MS,
  maxLag = FOLLOW_MAX_LAG,
  now = () => Date.now()
}: {
  /** The node on the board when following starts (null: a BEST line is shown). */
  board: string | null;
  /** Puts the board on a move. Its own store update comes back through `noteBoard`. */
  show: (step: FollowStep) => void;
  onPausedChange?: (paused: boolean) => void;
  stepMs?: number;
  maxLag?: number;
  now?: () => number;
}): AnalysisFollower {
  let line: readonly string[] = [];
  let target: number | null = null;
  // The board's node as far as following knows (null: off the game's moves, on a BEST line).
  let board = initialBoard;
  let paused = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastStepAt = -Infinity;

  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const setPaused = (next: boolean) => {
    if (paused === next) return;
    paused = next;
    onPausedChange?.(next);
  };
  const boardIndex = () => (board === null ? -1 : line.indexOf(board));
  const place = (nodeId: string, quiet: boolean) => {
    board = nodeId;
    lastStepAt = now();
    show({ nodeId, quiet });
  };
  /** Jumps straight to `nodeId`: with sound only when that is a single step forwards. */
  const jump = (nodeId: string) => {
    const from = boardIndex();
    place(nodeId, from < 0 || line.indexOf(nodeId) - from !== 1);
  };

  const advance = () => {
    if (disposed || paused || target === null || timer !== null) return;
    const to = target;
    const from = boardIndex();
    if (from === to) return;
    const wait = lastStepAt + stepMs - now();
    if (wait > 0) {
      timer = setTimeout(() => {
        timer = null;
        advance();
      }, wait);
      return;
    }
    const lag = to - from;
    // Off the line, ahead of the analysis or too far behind: one quiet jump. Else the next move.
    if (from < 0 || lag < 0 || lag > maxLag) place(line[to]!, true);
    else place(line[from + 1]!, false);
    advance();
  };

  return {
    update(nextLine, targetIndex) {
      line = nextLine;
      target = targetIndex >= 0 && targetIndex < nextLine.length ? targetIndex : null;
      advance();
    },
    noteBoard(nodeId, browsingLine) {
      if (disposed || (nodeId === board && !browsingLine)) return;
      board = browsingLine ? null : nodeId;
      cancel();
      setPaused(true);
    },
    pause() {
      if (disposed) return;
      cancel();
      setPaused(true);
    },
    resume() {
      if (disposed || !paused) return;
      setPaused(false);
      const nodeId = target === null ? undefined : line[target];
      if (nodeId !== undefined && boardIndex() !== target) jump(nodeId);
      advance();
    },
    finish(lastNodeId) {
      if (disposed) return;
      cancel();
      if (!paused && board !== lastNodeId) jump(lastNodeId);
      disposed = true;
    },
    dispose() {
      disposed = true;
      cancel();
    },
    isPaused: () => paused
  };
}
