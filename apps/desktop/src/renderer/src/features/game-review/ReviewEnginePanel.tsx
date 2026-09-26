import { useMemo } from "react";
import { Cpu } from "lucide-react";
import type { MoveReview } from "@chaturanga/shared/types/engine";
import type { TacticalFact } from "@chaturanga/shared/schemas";
import { formatMillisecondsClock } from "@chaturanga/shared/chess/clock-display";
import { buildEngineSignals, buildRatingCurveForMove, buildTacticalFacts, hasUsableMaiaData, lineDelta, moveLabel, uciLineToSan } from "./review-utils";
import { formatMoveEval, formatScore } from "./review-score";
import { RatingCurve } from "./RatingCurve";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/page";
import { Stat, StatGroup } from "@/components/ui/stat";
import { divider } from "@/lib/ui";
import { QualityBadge } from "@/components/ui/quality-badge";
import { replyLineUcis } from "./commentary-moves";
import { MoveLine, VariationAnchorNote, type GoToLine } from "./MoveLinks";

/** Engine evidence for the selected move: evals, best line, alternatives, Maia curve, derived facts. */
export function ReviewEnginePanel({
  move,
  hasReview = false,
  running = false,
  showTopLines,
  userRating,
  onAnalyze,
  moves = NO_MOVES,
  parentNodeId = null,
  onGoToLine,
  variationAnchor = null
}: {
  move: MoveReview | null;
  hasReview?: boolean;
  /** The engine pass is still running (the selected move may not be reviewed yet). */
  running?: boolean;
  showTopLines: boolean;
  userRating: number;
  /** Offered as the "No engine data yet" action. */
  onAnalyze?: () => void;
  /** All reviewed moves (older reviews derive the reply line from the next ply). */
  moves?: readonly MoveReview[];
  /** Tree node the best line and alternatives start from (the move's parent). */
  parentNodeId?: string | null;
  /** Jump to a position; each SAN in a line becomes a link when set. */
  onGoToLine?: GoToLine;
  /** Set while the board shows an unreviewed variation; `move` is then its nearest reviewed ancestor. */
  variationAnchor?: { label: string; onBack: () => void } | null;
}) {
  const facts = useMemo(() => (move ? buildTacticalFacts(move) : []), [move]);
  const signals = useMemo(() => (move ? buildEngineSignals(move) : []), [move]);
  const bestLine = useMemo(() => (move ? uciLineToSan(move.fenBefore, move.bestLine) : []), [move]);
  const replyLine = useMemo(
    () => (move && !move.terminal ? uciLineToSan(move.fenAfter, replyLineUcis(move, moves)).slice(0, 8) : []),
    [move, moves]
  );
  if (!move) {
    return (
      <div className="grid h-full place-items-center">
        <EmptyState
          icon={<Cpu />}
          title={running ? "Analyzing…" : hasReview ? "Select a move" : "No engine data yet"}
          description={running || hasReview ? "Engine evidence appears for reviewed moves." : "Analyze the game to see engine evaluations."}
          action={
            !running && !hasReview && onAnalyze ? (
              <Button variant="primary" size="sm" onClick={onAnalyze}>
                Analyze
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }
  const alternatives = showTopLines ? move.topLines.slice(0, 5) : [];

  return (
    <div className="scroll-area -mr-3 grid h-full min-h-0 content-start gap-4 overflow-y-auto pr-3">
      <header className="flex min-h-8 items-center gap-2">
        <h2 className="font-mono text-base font-semibold text-fg">{moveLabel(move)}</h2>
        <QualityBadge classification={move.classification} />
      </header>

      {variationAnchor ? <VariationAnchorNote label={variationAnchor.label} onBack={variationAnchor.onBack} /> : null}

      <StatGroup>
        <Stat label="Before" value={formatScore(move.evalBefore)} mono />
        <Stat label="After" value={formatMoveEval(move)} mono />
        <Stat label="Best" value={formatScore(move.bestEvalAfter)} mono />
        <Stat label="Loss" value={move.evalLoss === null ? "—" : `${move.evalLoss}cp`} mono />
        {move.timeSpentMs !== undefined ? <Stat label="Time" value={formatMillisecondsClock(move.timeSpentMs)} mono /> : null}
      </StatGroup>

      <section className="grid gap-1">
        <SectionHeader as="h3" title="Best line" />
        <p className="font-mono text-sm leading-6 text-accent">
          <MoveLine startNodeId={parentNodeId} sans={bestLine} onGoToLine={onGoToLine} />
        </p>
      </section>

      {replyLine.length && move.playedMove !== move.bestMove ? (
        <section className="grid gap-1">
          <SectionHeader as="h3" title="Best reply" />
          <p className="font-mono text-sm leading-6 text-fg-secondary">
            <MoveLine startNodeId={move.nodeId} sans={replyLine} onGoToLine={onGoToLine} linkClassName="text-current hover:text-accent" />
          </p>
        </section>
      ) : null}

      {alternatives.length ? (
        <>
          <div className={divider} />
          <section className="grid gap-1">
            <SectionHeader as="h3" title="Alternatives" />
            <ol className="divide-y divide-line-subtle">
              {alternatives.map((line, index) => (
                <li key={line.multipv} className="grid grid-cols-[1rem_3rem_minmax(0,1fr)_auto] items-center gap-2 py-1.5 font-mono text-xs">
                  <span className="text-fg-subtle">{index + 1}</span>
                  <span className="text-fg-secondary">{formatScore(line.scoreWhite)}</span>
                  <span className="truncate text-fg-muted">
                    <MoveLine startNodeId={parentNodeId} sans={uciLineToSan(move.fenBefore, line.pv.slice(0, 5))} onGoToLine={onGoToLine} empty="" linkClassName="text-current hover:text-accent" />
                  </span>
                  <span className="text-fg-subtle">{lineDelta(line, move.topLines[0])}</span>
                </li>
              ))}
            </ol>
          </section>
        </>
      ) : null}

      {hasUsableMaiaData(move) ? (
        <>
          <div className={divider} />
          <RatingCurve curve={buildRatingCurveForMove(move, userRating)} />
        </>
      ) : null}

      {facts.length || signals.length ? (
        <>
          <div className={divider} />
          <section className="grid gap-2">
            <SectionHeader as="h3" title="Evidence" />
            <div className="flex flex-wrap gap-1.5">
              {facts.map((fact, index) => (
                <Badge key={`fact-${index}`} tone="accent">
                  {fact.kind}
                  <span className="font-mono">{factSquare(fact)}</span>
                </Badge>
              ))}
              {signals.map((signal, index) => (
                <Badge key={`signal-${index}`} tone="info">{signal.kind.replaceAll("_", " ")}</Badge>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

const NO_MOVES: readonly MoveReview[] = [];

/** The square a tactical fact is about (the hanging/pinned piece, or the attacker). */
function factSquare(fact: TacticalFact): string {
  switch (fact.kind) {
    case "hanging":
      return fact.piece.square;
    case "pin":
      return fact.pinned.square;
    default:
      return fact.attacker.square;
  }
}
