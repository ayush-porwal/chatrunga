import { useEffect, useState, type CSSProperties } from "react";
import { Bot, KeyRound, MessageSquareOff, RefreshCw, Sparkles } from "lucide-react";
import type { MoveReview, ReviewCommentary } from "@chaturanga/shared/types/engine";
import { buildRatingCurveForMove, hasUsableMaiaData, moveLabel, uciToSan, type CommentaryDetail } from "./review-utils";
import { formatMoveEval } from "./review-score";
import { renderHeadline } from "@chaturanga/shared/chess/headline";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { usePresence } from "@/components/ui/use-presence";
import { motion } from "@/lib/ui";
import { Stat, StatGroup } from "@/components/ui/stat";
import { qualityTone } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { QualityBadge } from "@/components/ui/quality-badge";
import type { CommentaryMoveContext } from "./commentary-moves";
import type { CommentaryStatus } from "./useGameReviewCommentary";
import { CommentaryProse, MoveLink, VariationAnchorNote, type GoToLine } from "./MoveLinks";
import { isRapidNavigation } from "../board/board-motion";
import { Coachmark, useOnboardingHint } from "../onboarding/Coachmark";
import { tokenizeCommentary } from "./commentary-moves";
import "./review.css";

/**
 * The selected move's coaching view: the AI coach's headline and explanation (or the state of
 * the request for it), the Maia rating note, and one row of engine facts.
 * Detailed engine numbers (before/after evals, alternatives, evidence) live in the Engine tab.
 */
export function ReviewCommentaryPanel({
  move,
  hasReview = false,
  running = false,
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
  moveContext = null,
  onGoToLine,
  variationAnchor = null
}: {
  move: MoveReview | null;
  /** True once at least one move has been reviewed (picks the right empty state). */
  hasReview?: boolean;
  /** The engine pass is running: the panel holds one steady state until it finishes. */
  running?: boolean;
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
  /** Opens Settings → Commentary (where the OpenRouter key is saved). */
  onOpenCommentarySettings?: () => void;
  /** Switches to the review's own Settings tab. */
  onOpenReviewSettings?: () => void;
  /** Switches AI commentary back on (offered while it is off). */
  onTurnOnCommentary?: () => void;
  /** Grounded lines for `move`: SAN tokens in the prose resolve against them and become links. */
  moveContext?: CommentaryMoveContext | null;
  /** Jump to a position (board, move tree and graph follow the game store). */
  onGoToLine?: GoToLine;
  /** Set while the board shows an unreviewed variation; `move` is then its nearest reviewed ancestor. */
  variationAnchor?: { label: string; onBack: () => void } | null;
}) {
  const loading = !running && Boolean(move) && status === "loading";
  // The placeholder stays for one fade after the text arrives, so the two cross-fade in place.
  // (Hooks run before the early returns below.)
  const skeleton = usePresence(loading, motion.ms.standard);
  // One-time tip for the first explanation whose moves are links.
  const linkHint = useOnboardingHint(
    "commentary-links",
    !running && status === "ready" && Boolean(commentary && onGoToLine && moveContext) && hasMoveTokens(commentary)
  );
  const goToLineFromProse: GoToLine | undefined = onGoToLine
    ? (target) => {
        if (linkHint.visible) linkHint.dismiss();
        onGoToLine(target);
      }
    : undefined;

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

  if (!move) {
    return (
      <div className="grid h-full place-items-center">
        <EmptyState
          icon={<Sparkles />}
          title={hasReview ? "Select a move" : "No review yet"}
          description={hasReview ? "Pick a move on the graph or in the move list." : "Analyze the game, then select a move to read its review."}
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

  const played = uciToSan(move.fenBefore, move.playedMove) ?? move.playedMove;
  const best = uciToSan(move.fenBefore, move.bestMove);
  const maiaNote = hasUsableMaiaData(move) ? renderHeadline(buildRatingCurveForMove(move, userRating)) : null;
  const parentId = moveContext?.moveTree.find((node) => node.id === move.nodeId)?.parentId ?? null;
  const linkTo = (san: string | null) =>
    san && parentId && onGoToLine ? () => onGoToLine({ startNodeId: parentId, moves: [san] }) : null;
  const goToPlayed = linkTo(played);
  const goToBest = linkTo(best);
  // A new move settles in with a short partial fade — except while scrubbing through moves.
  const swap = isRapidNavigation() ? undefined : "review-swap";
  const ready = status === "ready" && commentary;

  return (
    <div key={move.nodeId} className={cn("scroll-area -mr-3 grid h-full min-h-0 content-start gap-4 overflow-y-auto pr-3", swap)}>
      <header className="flex min-h-8 flex-wrap items-center gap-2">
        <h2 className="font-mono text-base font-semibold text-fg">{moveLabel(move)}</h2>
        <QualityBadge classification={move.classification} />
        {ready ? (
          <span
            className="ml-auto inline-flex min-w-0 animate-fade-in items-center gap-1 text-2xs text-fg-subtle"
            title={`Written by ${commentary.providerModel}`}
          >
            <Bot className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{shortModelName(commentary.providerModel)}</span>
          </span>
        ) : null}
      </header>

      {variationAnchor ? <VariationAnchorNote label={variationAnchor.label} onBack={variationAnchor.onBack} /> : null}

      <section
        aria-label="Commentary"
        aria-busy={status === "loading"}
        className={cn(
          "grid content-start [grid-template-areas:'stack']",
          // Loading and loaded share a reserved height; the short states (error, no key, off) don't.
          (skeleton.present || ready) && "review-commentary"
        )}
        style={{ "--review-commentary-lines": SKELETON_LINES[detail] } as CSSProperties}
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
          <div key="text" className="grid animate-fade-in gap-3 [grid-area:stack]">
            {commentary.headline ? (
              <h3 className="font-serif text-lg font-semibold leading-7 text-fg">
                <CommentaryProse prose={commentary.headline} context={moveContext} onGoToLine={goToLineFromProse} />
              </h3>
            ) : null}
            <p className="font-serif text-base leading-7 text-fg-secondary">
              <CommentaryProse prose={commentary.prose} context={moveContext} onGoToLine={goToLineFromProse} />
            </p>
          </div>
        ) : loading ? null : status === "error" ? (
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
        ) : status === "no-key" ? (
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
        ) : status === "off" ? (
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
        ) : status === "no-payload" ? (
          <p key="no-payload" className="animate-fade-in text-sm leading-6 text-fg-muted [grid-area:stack]">
            The engine didn't return enough data about this move to explain it. The facts below still apply.
          </p>
        ) : null}
      </section>

      {ready && linkHint.visible ? (
        <Coachmark onDismiss={linkHint.dismiss}>
          Moves in the explanation are links. Click one to play the line on the board.
        </Coachmark>
      ) : null}

      {maiaNote ? <p className="text-xs leading-5 text-fg-subtle">{maiaNote}</p> : null}

      <StatGroup>
        <Stat
          label="Played"
          value={goToPlayed ? <MoveLink san={played} onActivate={goToPlayed} className="text-current" /> : played}
          mono
          valueClassName={qualityTone[move.classification].text}
        />
        <Stat
          label="Best"
          value={best && goToBest ? <MoveLink san={best} onActivate={goToBest} /> : best ?? "—"}
          mono
          valueClassName="text-accent"
        />
        <Stat label="Eval" value={formatMoveEval(move)} mono />
        <Stat label="Loss" value={move.evalLoss === null ? "—" : `${move.evalLoss}cp`} mono />
      </StatGroup>
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
        <span className="review-glyph mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-accent" aria-hidden>
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
          <p key={slow ? "slow" : "model"} className="animate-fade-in truncate text-2xs leading-4 text-fg-subtle" title={`${model} via OpenRouter`}>
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
              style={{ width: index === lines - 1 ? "58%" : LINE_WIDTHS[index % LINE_WIDTHS.length] }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Whether the explanation mentions any move (those become links). */
function hasMoveTokens(commentary: ReviewCommentary | undefined): boolean {
  if (!commentary) return false;
  return [commentary.headline ?? "", commentary.prose].some((text) => tokenizeCommentary(text).some((segment) => segment.kind === "move"));
}

/** "anthropic/claude-sonnet-4.6" → "claude-sonnet-4.6"; the full id is in the tooltip. */
function shortModelName(model: string): string {
  return model.split("/").pop() || model;
}
