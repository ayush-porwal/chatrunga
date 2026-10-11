import { useEffect, useState } from "react";
import { Bot, KeyRound, MessageSquareOff, RefreshCw, Sparkles } from "lucide-react";
import type { MoveReview, ReviewCommentary } from "@chaturanga/shared/types/engine";
import {
  buildRatingCurveForMove,
  hasUsableMaiaData,
  moveLabel,
  uciToSan,
  type CommentaryDetail
} from "./review-utils";
import { formatMoveEval } from "./review-score";
import { renderHeadline } from "@chaturanga/shared/chess/headline";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { usePresence } from "@/components/ui/use-presence";
import { motion, annotationTone } from "@/lib/ui";
import { Stat, StatGroup } from "@/components/ui/stat";
import { cn } from "@/lib/utils";
import { AnnotationBadge } from "@/components/ui/annotation-badge";
import { SectionHeader } from "@/components/ui/page";
import type { KeyMoment } from "@chaturanga/shared/chess/key-moments";
import { MomentList } from "./KeyMoments";
import type { CommentaryMoveContext } from "./commentary-moves";
import type { CommentaryStatus } from "./useGameReviewCommentary";
import { CommentaryProse, MoveLink, VariationAnchorNote, type GoToLine } from "./MoveLinks";
import { isRapidNavigation } from "../board/board-motion";
import "./review.css";

/**
 * The selected move's coaching view: the AI coach's headline and explanation (or the state of
 * the request for it), the Maia rating note, and one row of engine facts.
 * Detailed engine numbers (before/after evals, alternatives, evidence) live in the Engine tab.
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
  onOpenReviewSettings,
  onTurnOnCommentary,
  moveContext,
  onGoToLine,
  variationAnchor,
  keyMoments,
  reviewMoves,
  onSelectNode,
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
  /** Switches to the review's own Settings tab. */
  onOpenReviewSettings?: () => void;
  /** Switches AI commentary back on (offered while it is off). */
  onTurnOnCommentary?: () => void;
  /** Grounded lines for `move`: SAN tokens in the prose resolve against them and become links. */
  moveContext: CommentaryMoveContext | null;
  /** Jump to a position (board, move tree and graph follow the game store). */
  onGoToLine?: GoToLine;
  /** Set while the board shows an unreviewed variation; `move` is then its nearest reviewed ancestor. */
  variationAnchor: { label: string; onBack: () => void } | null;
  /** The review's key moments: what the panel leads with before a move is selected. */
  keyMoments: readonly KeyMoment[];
  /** The reviewed moves the key moments point at. */
  reviewMoves: readonly MoveReview[];
  /** Goes to a move (a key moment's row). */
  onSelectNode?: (nodeId: string) => void;
  /** Set when the explanation was written before the current move marks (see useGameReviewCommentary). */
  rewrite: Rewrite | null;
}) {
  const loading = !running && Boolean(move) && status === "loading";
  // The placeholder stays for one fade after the text arrives, so the two cross-fade in place.
  // (Hooks run before the early returns below.)
  const skeleton = usePresence(loading, motion.ms.standard);

  if (running) {
    return (
      <div className="grid h-full place-items-center">
        <EmptyState
          icon={<Sparkles />}
          title="Analyzing…"
          description="Commentary is available when the analysis finishes. Progress is shown below."
        />
      </div>
    );
  }

  if (!move)
    return (
      <NoMoveSelected
        hasReview={hasReview}
        keyMoments={keyMoments}
        reviewMoves={reviewMoves}
        onSelectNode={onSelectNode}
        onAnalyze={onAnalyze}
      />
    );

  // A new move settles in with a short partial fade — except while scrubbing through moves.
  const swap = isRapidNavigation() ? undefined : "review-swap";
  const ready = status === "ready" && commentary;

  return (
    <div
      key={move.nodeId}
      className={cn(
        "scroll-area -mr-3 grid h-full min-h-0 content-start gap-4 overflow-y-auto pr-3",
        swap
      )}
    >
      <CommentaryHeader move={move} writtenBy={ready ? commentary.providerModel : null} />

      {variationAnchor ? (
        <VariationAnchorNote label={variationAnchor.label} onBack={variationAnchor.onBack} />
      ) : null}

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
            onOpenReviewSettings={onOpenReviewSettings}
            onTurnOnCommentary={onTurnOnCommentary}
          />
        )}
      </section>

      <MaiaNote move={move} userRating={userRating} />

      <MoveFacts move={move} moveContext={moveContext} onGoToLine={onGoToLine} />
    </div>
  );
}

/** The move, its mark, and (once written) the model that wrote its commentary (`writtenBy`). */
function CommentaryHeader({ move, writtenBy }: { move: MoveReview; writtenBy: string | null }) {
  return (
    <header className="flex min-h-8 flex-wrap items-center gap-2">
      <h2 className="font-mono text-base font-semibold text-fg">{moveLabel(move)}</h2>
      <AnnotationBadge annotation={move.assessment?.annotation ?? null} />
      {writtenBy ? (
        <span
          className="ml-auto inline-flex min-w-0 animate-fade-in items-center gap-1 text-2xs text-fg-subtle"
          title={`Written by ${writtenBy}`}
        >
          <Bot className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{shortModelName(writtenBy)}</span>
        </span>
      ) : null}
    </header>
  );
}

/** What Maia says about the move at the player's rating (nothing without usable Maia data). */
function MaiaNote({ move, userRating }: { move: MoveReview; userRating: number }) {
  if (!hasUsableMaiaData(move)) return null;
  const note = renderHeadline(buildRatingCurveForMove(move, userRating));
  return note ? <p className="text-xs leading-5 text-fg-subtle">{note}</p> : null;
}

/**
 * No move to explain: the review's key moments to pick from, else what to do first (select a move,
 * or analyse the game).
 */
function NoMoveSelected({
  hasReview,
  keyMoments,
  reviewMoves,
  onSelectNode,
  onAnalyze
}: {
  hasReview: boolean;
  keyMoments: readonly KeyMoment[];
  reviewMoves: readonly MoveReview[];
  onSelectNode?: (nodeId: string) => void;
  onAnalyze?: () => void;
}) {
  if (hasReview && keyMoments.length && onSelectNode) {
    return (
      <div className="scroll-area -mr-3 grid h-full min-h-0 content-start gap-3 overflow-y-auto pr-3">
        <SectionHeader as="h2" title="Key moments" />
        <p className="text-sm leading-6 text-fg-muted">
          The moments that decided this game. Select one to read about it; every move stays in the
          Moves tab.
        </p>
        <MomentList
          moments={keyMoments}
          moves={reviewMoves}
          selectedNodeId={null}
          onSelectNode={onSelectNode}
          label="Key moments of the game"
          emptyTitle="No key moments"
        />
      </div>
    );
  }
  return (
    <div className="grid h-full place-items-center">
      <EmptyState
        icon={<Sparkles />}
        title={hasReview ? "Select a move" : "No review yet"}
        description={
          hasReview
            ? "Pick a move on the graph or in the move list."
            : "Analyze the game, then select a move to read its review."
        }
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

/** The coach's headline and explanation, under a note when it predates the move marks. */
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
    <div className="grid animate-fade-in gap-3 [grid-area:stack]">
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
    </div>
  );
}

/**
 * Why there is no commentary to read (nothing while it loads): the request failed, there is no
 * OpenRouter key, commentary is off, or the engine gave too little to explain.
 */
function CommentaryState({
  status,
  error,
  onRetry,
  onOpenCommentarySettings,
  onOpenReviewSettings,
  onTurnOnCommentary
}: {
  status: CommentaryStatus;
  error: string | null | undefined;
  onRetry: () => void;
  onOpenCommentarySettings?: () => void;
  onOpenReviewSettings?: () => void;
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
        <EmptyState
          key="no-key"
          className="py-6 [grid-area:stack]"
          icon={<KeyRound />}
          title="Commentary needs an OpenRouter key"
          description="Each move is explained by an AI model through your own OpenRouter account. Add your API key to start."
          action={
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
              {onOpenCommentarySettings ? (
                <Button variant="primary" size="sm" onClick={onOpenCommentarySettings}>
                  Add API key
                </Button>
              ) : null}
              {onOpenReviewSettings ? (
                <Button variant="link" size="sm" onClick={onOpenReviewSettings}>
                  Review settings
                </Button>
              ) : null}
            </div>
          }
        />
      );
    case "off":
      return (
        <EmptyState
          key="off"
          className="py-6 [grid-area:stack]"
          icon={<MessageSquareOff />}
          title="AI commentary is off"
          description="Turn it on to have each move you select explained."
          action={
            onTurnOnCommentary ? (
              <Button variant="outline" size="sm" onClick={onTurnOnCommentary}>
                Turn on
              </Button>
            ) : undefined
          }
        />
      );
    case "no-payload":
      return (
        <p
          key="no-payload"
          className="animate-fade-in text-sm leading-6 text-fg-muted [grid-area:stack]"
        >
          The engine didn't return enough data about this move to explain it. The facts below still
          apply.
        </p>
      );
    default:
      return null;
  }
}

/**
 * One row of the move's engine facts: the move played and the best (each going there), eval, loss.
 */
function MoveFacts({
  move,
  moveContext,
  onGoToLine
}: {
  move: MoveReview;
  moveContext: CommentaryMoveContext | null;
  onGoToLine?: GoToLine;
}) {
  const played = uciToSan(move.fenBefore, move.playedMove) ?? move.playedMove;
  const best = uciToSan(move.fenBefore, move.bestMove);
  const annotation = move.assessment?.annotation ?? null;
  const parentId = moveContext?.moveTree.find((node) => node.id === move.nodeId)?.parentId ?? null;
  const linkTo = (san: string | null) =>
    san && parentId && onGoToLine
      ? () => onGoToLine({ startNodeId: parentId, moves: [san] })
      : null;
  const goToPlayed = linkTo(played);
  const goToBest = linkTo(best);
  return (
    <StatGroup>
      <Stat
        label="Played"
        value={
          goToPlayed ? (
            <MoveLink san={played} onActivate={goToPlayed} className="text-current" />
          ) : (
            played
          )
        }
        mono
        valueClassName={annotation ? annotationTone[annotation].text : undefined}
      />
      <Stat
        label="Best"
        value={best && goToBest ? <MoveLink san={best} onActivate={goToBest} /> : (best ?? "—")}
        mono
        valueClassName="text-accent"
      />
      <Stat label="Eval" value={formatMoveEval(move)} mono />
      <Stat label="Loss" value={move.evalLoss === null ? "—" : `${move.evalLoss}cp`} mono />
    </StatGroup>
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
