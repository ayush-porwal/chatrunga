import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Bot,
  KeyRound,
  MessageSquareOff,
  RefreshCw,
  Sparkles,
  Users
} from "lucide-react";
import type { MoveReview, ReviewCommentary } from "@chaturanga/shared/types/engine";
import {
  buildRatingCurveForMove,
  hasUsableMaiaData,
  moveLabel,
  type CommentaryDetail
} from "./review-utils";
import { formatScore, terminalEvalLabel } from "./review-score";
import { renderHeadline } from "@chaturanga/shared/chess/headline";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { usePresence } from "@/components/ui/use-presence";
import { motion } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useGameStore } from "../../stores/game-store";
import { activeBestLine } from "../game/best-line-cursor";
import { BestLineRow } from "../game/BestLineRow";
import { ScorePill } from "../analysis/EngineLines";
import type { CommentaryMoveContext } from "./commentary-moves";
import type { CommentaryStatus } from "./useGameReviewCommentary";
import { CommentaryProse, VariationAnchorNote, type GoToLine } from "./MoveLinks";
import { ReviewMoveHeader, usePiecePanel } from "./ReviewMoveParts";
import { isRapidNavigation } from "../board/board-motion";
import "./review.css";

/**
 * The selected move's coaching view: the move and its mark, how the evaluation changed, the
 * engine's BEST line for a marked error, the AI coach's explanation (or the state of the request
 * for it) and the Maia note. The engine's numbers (facts, lines, candidate moves, evidence) are in
 * the Engine tab.
 */
export function ReviewCommentaryPanel({
  move,
  hasReview,
  running,
  status,
  commentary,
  model,
  error,
  detail,
  userRating,
  onRetry,
  onAnalyze,
  onOpenCommentarySettings,
  onTurnOnCommentary,
  moveContext,
  onGoToLine,
  variationAnchor,
  rewrite
}: {
  move: MoveReview | null;
  /** True once at least one move has been reviewed (picks the right empty state). */
  hasReview: boolean;
  /** The engine pass is running: the panel holds one steady state until it finishes. */
  running: boolean;
  /** State of the AI commentary for `move`. */
  status: CommentaryStatus;
  /** The AI explanation, when `status` is "ready". */
  commentary: ReviewCommentary | undefined;
  /** The OpenRouter model that is writing the commentary (named while it loads). */
  model: string;
  /** Why the request failed, when `status` is "error". */
  error?: string | null;
  /** Requested length; sizes the loading placeholder like the text it stands in for. */
  detail: CommentaryDetail;
  userRating: number;
  /** Ask again for this move only. */
  onRetry: () => void;
  /** Offered as the "No review yet" action. */
  onAnalyze?: () => void;
  /** Opens Settings → AI (where the OpenRouter key is saved). */
  onOpenCommentarySettings?: () => void;
  /** Switches AI commentary back on (offered while it is off). */
  onTurnOnCommentary?: () => void;
  /** Grounded lines for `move`: SAN tokens in the prose resolve against them and become links. */
  moveContext: CommentaryMoveContext | null;
  /** Jump to a position (board, move tree and graph follow the game store). */
  onGoToLine?: GoToLine;
  /** Set while the board shows an unreviewed variation; `move` is then its nearest reviewed ancestor. */
  variationAnchor: { label: string; onBack: () => void } | null;
  /** Set when the explanation was written before the current move marks (see useGameReviewCommentary). */
  rewrite: Rewrite | null;
}) {
  const loading = !running && Boolean(move) && status === "loading";
  // The placeholder stays for one fade after the text arrives, so the two cross-fade in place.
  // (Hooks run before the early returns below.)
  const skeleton = usePresence(loading, motion.ms.standard);
  // A new move settles in with a short partial fade — except while scrubbing through moves.
  const panel = usePiecePanel(
    cn(
      "scroll-area -mr-3 h-full min-h-0 content-start gap-3.5 overflow-y-auto pr-3",
      !isRapidNavigation() && "review-swap"
    )
  );

  if (running) {
    return (
      <div className="grid h-full place-items-center">
        <EmptyState
          icon={<Sparkles />}
          title="Analyzing…"
          description="Commentary is written once the analysis finishes."
        />
      </div>
    );
  }

  if (!move) return <NoMoveSelected hasReview={hasReview} onAnalyze={onAnalyze} />;

  const ready = status === "ready" && commentary;

  return (
    <div key={move.nodeId} className={panel.className} style={panel.style}>
      <ReviewMoveHeader move={move} />

      {variationAnchor ? (
        <VariationAnchorNote label={variationAnchor.label} onBack={variationAnchor.onBack} />
      ) : null}

      <EvalChange move={move} />
      <BestLine move={move} />

      <section
        aria-label="Commentary"
        aria-busy={status === "loading"}
        className={cn(
          "grid content-start [grid-template-areas:'stack']",
          // Loading and loaded share a reserved height; the short states (error, no key, off) don't.
          (skeleton.present || ready) && "review-commentary"
        )}
        style={{ "--review-commentary-lines": SKELETON_LINES[detail] }}
      >
        {skeleton.present ? (
          <CommentarySkeleton
            key="loading"
            moveLabel={moveLabel(move)}
            lines={SKELETON_LINES[detail]}
            model={model}
            className={cn("[grid-area:stack]", !loading && "pointer-events-none animate-fade-out")}
          />
        ) : null}
        {ready ? (
          <CommentaryText
            key="text"
            commentary={commentary}
            rewrite={rewrite}
            moveContext={moveContext}
            onGoToLine={onGoToLine}
          />
        ) : (
          <CommentaryState
            status={status}
            error={error}
            onRetry={onRetry}
            onOpenCommentarySettings={onOpenCommentarySettings}
            onTurnOnCommentary={onTurnOnCommentary}
          />
        )}
      </section>

      <MaiaNote move={move} userRating={userRating} />
    </div>
  );
}

/** The evaluation pills' size here: a step up from the engine lines'. */
const EVAL_PILL = "h-7 min-w-16 px-2.5 text-sm";

/**
 * How the move changed the evaluation, as Analyze's score pills (light while White is better, dark
 * while Black is): before → after, then the loss (as the Engine tab's Loss reads, `138 cp`; none
 * for a move that lost nothing). A game-ending move reads as its result. The header's disc and
 * pill carry the mark, so the pills stay neutral.
 */
function EvalChange({ move }: { move: MoveReview }) {
  const loss = move.evalLoss ?? 0;
  const ending = terminalEvalLabel(move);
  const after = ending ?? formatScore(move.evalAfter, 2);
  const spoken = move.evalBefore
    ? `Evaluation ${formatScore(move.evalBefore, 2)} to ${after}`
    : `Evaluation ${after}`;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="sr-only">{loss > 0 ? `${spoken}, loss ${loss} centipawns` : spoken}</span>
      <span aria-hidden className="contents">
        {move.evalBefore ? (
          <>
            <ScorePill score={move.evalBefore} className={EVAL_PILL} />
            <ArrowRight className="size-3.5 text-fg-subtle" />
          </>
        ) : null}
        {ending ? (
          <span className="inline-flex h-7 items-center rounded-md bg-control px-2.5 font-mono text-sm font-semibold text-fg">
            {ending}
          </span>
        ) : (
          <ScorePill score={move.evalAfter} className={EVAL_PILL} />
        )}
        {loss > 0 ? (
          <span className="ml-1 text-xs text-fg-subtle">
            Loss <span className="font-mono font-medium text-fg-muted tabular-nums">{loss}</span> cp
          </span>
        ) : null}
      </span>
    </p>
  );
}

/**
 * A marked error's BEST line, as the move list shows it under the move (BestLineRow): resting on
 * a move previews its position, clicking one shows it on the board (← → step along the line).
 */
function BestLine({ move }: { move: MoveReview }) {
  const node = useGameStore((state) => state.moveTree.find((item) => item.id === move.nodeId));
  const orientation = useGameStore((state) => state.orientation);
  const showBestLine = useGameStore((state) => state.showBestLine);
  const browsed = useGameStore(activeBestLine);
  if (!node) return null;
  return (
    <BestLineRow
      id={`commentary-best-${move.nodeId}`}
      node={node}
      review={move}
      // The row starts at the list's move column: here, the panel's left edge.
      gridClassName="grid-cols-[0_minmax(0,1fr)] -mb-1.5"
      orientation={orientation}
      currentIndex={browsed?.markedNodeId === move.nodeId ? browsed.index : null}
      onBrowse={showBestLine}
    />
  );
}

/** What Maia says about the move at the player's rating (nothing without usable Maia data). */
function MaiaNote({ move, userRating }: { move: MoveReview; userRating: number }) {
  if (!hasUsableMaiaData(move)) return null;
  const note = renderHeadline(buildRatingCurveForMove(move, userRating));
  if (!note) return null;
  return (
    <p className="flex gap-2 text-xs leading-5 text-fg-muted">
      <Users className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" aria-hidden />
      {note}
    </p>
  );
}

/** No move to explain: select one, or analyse the game first. */
function NoMoveSelected({ hasReview, onAnalyze }: { hasReview: boolean; onAnalyze?: () => void }) {
  return (
    <div className="grid h-full place-items-center">
      <EmptyState
        icon={<Sparkles />}
        title={hasReview ? "Select a move" : "No review yet"}
        action={
          !hasReview && onAnalyze ? (
            <Button variant="primary" size="sm" onClick={onAnalyze}>
              Analyze
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}

type Rewrite = { run: (() => void) | null; pending: boolean; error: string | null };

/**
 * The coach's headline and explanation, under a note when it predates the move marks, then the
 * model that wrote it.
 */
function CommentaryText({
  commentary,
  rewrite,
  moveContext,
  onGoToLine
}: {
  commentary: ReviewCommentary;
  rewrite: Rewrite | null;
  moveContext: CommentaryMoveContext | null;
  onGoToLine?: GoToLine;
}) {
  return (
    <div className="grid animate-fade-in content-start gap-3 [grid-area:stack]">
      {rewrite ? (
        <Notice
          tone="info"
          title="Written before the current move marks"
          action={
            rewrite.run ? (
              <Button variant="outline" size="xs" disabled={rewrite.pending} onClick={rewrite.run}>
                <RefreshCw />
                {rewrite.pending ? "Writing…" : "Write again"}
              </Button>
            ) : undefined
          }
        >
          {rewrite.error ?? "It may praise or judge this move differently from its mark above."}
        </Notice>
      ) : null}
      {commentary.headline ? (
        <h3 className="font-serif text-lg font-semibold leading-7 text-fg">
          <CommentaryProse
            prose={commentary.headline}
            context={moveContext}
            onGoToLine={onGoToLine}
          />
        </h3>
      ) : null}
      <p className="font-serif text-base leading-7 text-fg-secondary">
        <CommentaryProse prose={commentary.prose} context={moveContext} onGoToLine={onGoToLine} />
      </p>
      {commentary.providerModel ? (
        <span
          className="inline-flex h-6 w-fit max-w-full items-center gap-1.5 rounded-md bg-fg/[0.05] px-2 text-2xs text-fg-muted"
          title={`Written by ${commentary.providerModel}`}
        >
          <Bot className="size-3.5 shrink-0" aria-hidden />
          <span className="sr-only">Written by </span>
          <span className="truncate">{shortModelName(commentary.providerModel)}</span>
        </span>
      ) : null}
    </div>
  );
}

/**
 * Why there is no commentary to read (nothing while it loads, or while the review can't be
 * explained — the notices above the tab say why): the request failed, there is no OpenRouter key,
 * commentary is off, or the engine gave too little to explain.
 */
function CommentaryState({
  status,
  error,
  onRetry,
  onOpenCommentarySettings,
  onTurnOnCommentary
}: {
  status: CommentaryStatus;
  error: string | null | undefined;
  onRetry: () => void;
  onOpenCommentarySettings?: () => void;
  onTurnOnCommentary?: () => void;
}) {
  switch (status) {
    case "error":
      return (
        <Notice
          key="error"
          tone="warn"
          title="Couldn't write commentary for this move."
          className="self-start [grid-area:stack]"
          action={
            <Button variant="outline" size="xs" onClick={onRetry}>
              <RefreshCw />
              Retry
            </Button>
          }
        >
          {error}
        </Notice>
      );
    case "no-key":
      return (
        <CommentaryOffer
          key="no-key"
          icon={<KeyRound />}
          title="Commentary needs an OpenRouter key"
          description="Each move is explained by an AI model through your own OpenRouter account. Add your API key to start."
          action={
            onOpenCommentarySettings ? (
              <Button variant="primary" size="xs" onClick={onOpenCommentarySettings}>
                Add API key
              </Button>
            ) : null
          }
        />
      );
    case "off":
      return (
        <CommentaryOffer
          key="off"
          icon={<MessageSquareOff />}
          title="AI commentary is off"
          description="Turn it on to have each move you select explained."
          action={
            onTurnOnCommentary ? (
              <Button variant="outline" size="xs" onClick={onTurnOnCommentary}>
                Turn on
              </Button>
            ) : null
          }
        />
      );
    case "no-payload":
      return (
        <p
          key="no-payload"
          className="animate-fade-in text-sm leading-6 text-fg-muted [grid-area:stack]"
        >
          The engine didn&apos;t return enough data about this move to explain it. Its facts are in
          the Engine tab.
        </p>
      );
    default:
      return null;
  }
}

/** A compact row where the commentary would be: why there is none and the one step to get it. */
function CommentaryOffer({
  icon,
  title,
  description,
  action
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action: ReactNode;
}) {
  return (
    <div className="flex animate-fade-in items-center gap-3 self-start rounded-lg bg-fg/[0.03] px-3 py-2.5 [grid-area:stack] [&>svg]:size-4.5 [&>svg]:shrink-0 [&>svg]:text-fg-muted">
      {icon}
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="text-[0.8125rem] font-semibold text-fg">{title}</p>
        <p className="text-xs leading-5 text-fg-muted">{description}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** Body lines of the loading placeholder per requested length (the real text is usually longer). */
const SKELETON_LINES: Record<CommentaryDetail, number> = { concise: 3, balanced: 4, detailed: 6 };

/** Ragged right edge, so the placeholder reads as a paragraph rather than a stack of bars. */
const LINE_WIDTHS = ["100%", "94%", "97%", "89%", "96%", "91%"];

/** After this long the status line reassures that the model is still working. */
const SLOW_AFTER_MS = 8000;

/**
 * Shown while the AI coach writes this move's commentary: a status that says so in words (the
 * move, the model, a gently breathing sparkle and a typing ellipsis), then bars shaped like the
 * headline and paragraph under one slow light sweep. The status appears at once — also during
 * the short debounce before the request — while the bars are held back for a beat so a fast
 * answer never flashes them. Reduced motion: everything holds still.
 */
function CommentarySkeleton({
  moveLabel,
  lines,
  model,
  className
}: {
  moveLabel: string;
  lines: number;
  model: string;
  className?: string;
}) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className={cn("review-skeleton grid content-start gap-3", className)}>
      <div className="flex items-start gap-2.5" role="status">
        <span
          className="review-glyph mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-accent"
          aria-hidden
        >
          <Sparkles className="size-3.5" />
        </span>
        <div className="grid min-w-0 gap-0.5">
          <p className="text-sm leading-5 font-medium text-fg-secondary">
            {slow ? "Still writing commentary for" : "Writing commentary for"}{" "}
            <span className="font-mono text-fg">{moveLabel}</span>
            <span className="review-ellipsis ml-0.5" aria-hidden>
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </p>
          <p
            key={slow ? "slow" : "model"}
            className="animate-fade-in truncate text-2xs leading-4 text-fg-subtle"
            title={`${model} via OpenRouter`}
          >
            {slow ? (
              "Larger models can take up to a minute."
            ) : (
              <>
                <span className="text-fg-muted">{model}</span> via OpenRouter
              </>
            )}
          </p>
        </div>
      </div>
      <div className="grid" aria-hidden>
        <div className="flex h-7 items-center">
          <Skeleton className="h-4 w-3/5 rounded" />
        </div>
        {Array.from({ length: lines }, (_, index) => (
          <div key={index} className="flex h-7 items-center">
            <Skeleton
              className="h-3 rounded"
              style={{
                width: index === lines - 1 ? "58%" : LINE_WIDTHS[index % LINE_WIDTHS.length]
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** "anthropic/claude-sonnet-4.6" → "claude-sonnet-4.6"; the full id is in the tooltip. */
function shortModelName(model: string): string {
  return model.split("/").pop() || model;
}
