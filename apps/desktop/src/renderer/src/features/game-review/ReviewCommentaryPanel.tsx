import { Bot, CircleDashed, Lightbulb, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import type { MoveReview, ReviewCommentary } from "@chaturanga/shared/types/engine";
import type { CoachParts } from "@chaturanga/shared/llm/commentary";
import { buildRatingCurveForMove, hasUsableMaiaData, moveLabel, uciToSan } from "./review-utils";
import { formatMoveEval } from "./review-score";
import { renderHeadline } from "@chaturanga/shared/chess/headline";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { Stat, StatGroup } from "@/components/ui/stat";
import { qualityTone } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { QualityBadge } from "@/components/ui/quality-badge";
import type { CommentaryMoveContext } from "./commentary-moves";
import { CommentaryProse, MoveLink, VariationAnchorNote, type GoToLine } from "./MoveLinks";

/**
 * The selected move's coaching view: the coach's headline, prose and "next time" tip, the
 * Maia rating note, and one row of facts.
 * Detailed engine numbers (before/after evals, alternatives, evidence) live in the Engine tab.
 */
export function ReviewCommentaryPanel({
  move,
  hasReview = false,
  running = false,
  commentary,
  local,
  pending,
  error,
  canRetry = false,
  userRating,
  onRetry,
  onAnalyze,
  moveContext = null,
  onGoToLine,
  variationAnchor = null
}: {
  move: MoveReview | null;
  /** True once at least one move has been reviewed (picks the right empty state). */
  hasReview?: boolean;
  /** The engine pass is running: the panel holds one steady state until it finishes. */
  running?: boolean;
  /** Provider-written explanation, when one is cached for this move. */
  commentary: ReviewCommentary | undefined;
  /** Deterministic explanation shown immediately while (or instead of) the AI one. */
  local: CoachParts | null;
  /** An AI explanation for this move is being prepared. */
  pending: boolean;
  error?: string | null;
  canRetry?: boolean;
  userRating: number;
  onRetry: () => void;
  /** Offered as the "No review yet" action. */
  onAnalyze?: () => void;
  /** Grounded lines for `move`: SAN tokens in the prose resolve against them and become links. */
  moveContext?: CommentaryMoveContext | null;
  /** Jump to a position (board, move tree and graph follow the game store). */
  onGoToLine?: GoToLine;
  /** Set while the board shows an unreviewed variation; `move` is then its nearest reviewed ancestor. */
  variationAnchor?: { label: string; onBack: () => void } | null;
}) {
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
  const headline = commentary?.headline ?? local?.headline;
  const prose = commentary?.prose ?? local?.body ?? "The engine did not return enough information for a coaching explanation.";
  const takeaway = commentary?.takeaway ?? local?.takeaway;
  const parentId = moveContext?.moveTree.find((node) => node.id === move.nodeId)?.parentId ?? null;
  const linkTo = (san: string | null) =>
    san && parentId && onGoToLine ? () => onGoToLine({ startNodeId: parentId, moves: [san] }) : null;
  const goToPlayed = linkTo(played);
  const goToBest = linkTo(best);

  return (
    <div className="scroll-area -mr-3 grid h-full min-h-0 content-start gap-4 overflow-y-auto pr-3">
      <header className="flex min-h-8 flex-wrap items-center gap-2">
        <h2 className="font-mono text-base font-semibold text-fg">{moveLabel(move)}</h2>
        <QualityBadge classification={move.classification} />
        <span className="ml-auto inline-flex items-center gap-1 text-2xs text-fg-subtle" aria-live="polite">
          {pending ? (
            <>
              <LoaderCircle className="size-3.5 animate-spin" />
              Writing AI commentary…
            </>
          ) : commentary ? (
            <>
              <Bot className="size-3.5" />
              {commentarySourceLabel(commentary)}
            </>
          ) : (
            <>
              <CircleDashed className="size-3.5" />
              Local explanation
            </>
          )}
        </span>
      </header>

      {variationAnchor ? <VariationAnchorNote label={variationAnchor.label} onBack={variationAnchor.onBack} /> : null}

      {error ? <Notice tone="warn">{error}</Notice> : null}

      <div className={cn("grid gap-3 transition-opacity", pending && !commentary && "opacity-80")}>
        {headline ? (
          <h3 className="font-serif text-lg font-semibold leading-7 text-fg">
            <CommentaryProse prose={headline} context={moveContext} onGoToLine={onGoToLine} />
          </h3>
        ) : null}
        <p className="font-serif text-base leading-7 text-fg-secondary">
          <CommentaryProse prose={prose} context={moveContext} onGoToLine={onGoToLine} />
        </p>
        {takeaway ? (
          <p className="flex gap-2 text-sm leading-6 text-fg-muted">
            <Lightbulb className="mt-1 size-3.5 shrink-0 text-accent" aria-hidden />
            <span>
              <span className="font-medium text-fg-secondary">Next time: </span>
              <CommentaryProse prose={takeaway} context={moveContext} onGoToLine={onGoToLine} />
            </span>
          </p>
        ) : null}
        {maiaNote ? <p className="text-xs leading-5 text-fg-subtle">{maiaNote}</p> : null}
      </div>

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

      {canRetry ? (
        <Button variant="link" size="sm" className="justify-self-start" onClick={onRetry}>
          <RefreshCw />
          Retry AI commentary
        </Button>
      ) : null}
    </div>
  );
}

function commentarySourceLabel(commentary: ReviewCommentary): string {
  if (commentary.fallback || commentary.source === "local-fallback") return "Local fallback";
  // Older saved reviews may carry explanations from the retired hosted coach; show the model only.
  return commentary.source === "openrouter" ? `OpenRouter · ${commentary.providerModel}` : commentary.providerModel;
}
