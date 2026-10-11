import { useMemo } from "react";
import { Cpu } from "lucide-react";
import type { MoveReview } from "@chaturanga/shared/types/engine";
import type { TacticalFact } from "@chaturanga/shared/schemas";
import { formatMillisecondsClock } from "@chaturanga/shared/chess/clock-display";
import { quantizeToBucket } from "@chaturanga/shared/chess/rating-curve";
import {
  buildEngineSignals,
  buildRatingCurveForMove,
  buildTacticalFacts,
  hasUsableMaiaData,
  uciLineToSan,
  uciToSan
} from "./review-utils";
import { formatMoveEval } from "./review-score";
import { RatingCurve } from "./RatingCurve";
import { CandidateMoves } from "./CandidateMoves";
import { engineMoveRows, humanMoveRows, predictionLines } from "./rating-curve-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/page";
import { annotationTone } from "@/lib/ui";
import { replyLineUcis } from "./commentary-moves";
import { VariationAnchorNote, type GoToLine } from "./MoveLinks";
import { MoveLine, ReviewMoveHeader, usePiecePanel } from "./ReviewMoveParts";
import { cn } from "@/lib/utils";
import { StatCell, StatStrip } from "@/components/ui/stat-strip";
import { FigurineSan } from "../analysis/EngineLines";
import { isRapidNavigation } from "../board/board-motion";
import { Coachmark, useOnboardingHint } from "../onboarding/Coachmark";
import "./review.css";

/**
 * Engine evidence for the selected move: the move's facts, the engine's best line and best reply,
 * the candidate moves (Maia's beside the engine's), Maia's prediction across ratings, and the
 * tactical evidence.
 */
export function ReviewEnginePanel({
  move,
  hasReview,
  running,
  showTopLines,
  userRating,
  onAnalyze,
  moves,
  parentNodeId,
  onGoToLine,
  variationAnchor
}: {
  move: MoveReview | null;
  hasReview: boolean;
  /** The engine pass is still running (the selected move may not be reviewed yet). */
  running: boolean;
  /** List the engine's other candidate moves (Review settings → Show engine alternatives). */
  showTopLines: boolean;
  userRating: number;
  /** Offered as the "No review yet" action. */
  onAnalyze?: () => void;
  /** All reviewed moves (older reviews derive the reply line from the next ply). */
  moves: readonly MoveReview[];
  /** Tree node the best line and candidate moves start from (the move's parent). */
  parentNodeId: string | null;
  /** Jump to a position; each SAN in a line becomes a link when set. */
  onGoToLine?: GoToLine;
  /** Set while the board shows an unreviewed variation; `move` is then its nearest reviewed ancestor. */
  variationAnchor: { label: string; onBack: () => void } | null;
}) {
  const panel = usePiecePanel(
    cn(
      "scroll-area -mr-3 h-full min-h-0 auto-rows-max content-start gap-4 overflow-y-auto pr-3",
      !isRapidNavigation() && "review-swap"
    )
  );
  if (!move) return <NoEngineMove running={running} hasReview={hasReview} onAnalyze={onAnalyze} />;
  return (
    <div key={move.nodeId} className={panel.className} style={panel.style}>
      <ReviewMoveHeader move={move} />
      {variationAnchor ? (
        <VariationAnchorNote label={variationAnchor.label} onBack={variationAnchor.onBack} />
      ) : null}
      <MoveFacts move={move} />
      <EngineLinesSection
        move={move}
        moves={moves}
        parentNodeId={parentNodeId}
        onGoToLine={onGoToLine}
      />
      <HumanAndEngine
        move={move}
        showTopLines={showTopLines}
        userRating={userRating}
        parentNodeId={parentNodeId}
        onGoToLine={onGoToLine}
        running={running}
      />
      <Evidence move={move} />
    </div>
  );
}

/**
 * No reviewed move to show: the review is running, a move is still to pick, or there is no review.
 */
function NoEngineMove({
  running,
  hasReview,
  onAnalyze
}: {
  running: boolean;
  hasReview: boolean;
  onAnalyze?: () => void;
}) {
  return (
    <div className="grid h-full place-items-center">
      <EmptyState
        icon={<Cpu />}
        title={running ? "Analyzing…" : hasReview ? "Select a move" : "No review yet"}
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

/**
 * The move's facts, as Analyze's engine strip: Played / Best / Eval / Loss, then Win chance /
 * Engine rank / Time (when the game recorded it).
 */
function MoveFacts({ move }: { move: MoveReview }) {
  const played = uciToSan(move.fenBefore, move.playedMove) ?? move.san;
  const best = uciToSan(move.fenBefore, move.bestMove);
  const annotation = move.assessment?.annotation ?? null;
  return (
    <>
      <StatStrip className={FACT_COLUMNS}>
        <StatCell
          label="Played"
          size="sm"
          valueClassName={annotation ? annotationTone[annotation].text : undefined}
        >
          <SanFigurine san={played} />
        </StatCell>
        <StatCell label="Best" size="sm" valueClassName="text-accent">
          {best ? <SanFigurine san={best} /> : "—"}
        </StatCell>
        <StatCell label="Eval" size="sm">
          {formatMoveEval(move)}
        </StatCell>
        <StatCell label="Loss" size="sm">
          {move.evalLoss === null ? (
            "—"
          ) : (
            <>
              {move.evalLoss}
              <span className="ml-0.5 text-xs font-medium text-fg-subtle">cp</span>
            </>
          )}
        </StatCell>
      </StatStrip>
      <StatStrip className={FACT_COLUMNS}>
        <StatCell label="Win chance" size="sm">
          {formatChances(move)}
        </StatCell>
        <StatCell label="Engine rank" size="sm">
          {formatRank(move)}
        </StatCell>
        {move.timeSpentMs === undefined ? null : (
          <StatCell label="Time" size="sm">
            {formatMillisecondsClock(move.timeSpentMs)}
          </StatCell>
        )}
      </StatStrip>
    </>
  );
}

/** A move read out as its SAN, drawn with its figurine. */
function SanFigurine({ san }: { san: string }) {
  return (
    <>
      <span className="sr-only">{san}</span>
      <span aria-hidden>
        <FigurineSan san={san} />
      </span>
    </>
  );
}

/** The fact strips' columns: as many equal ones as the strip has cells. */
const FACT_COLUMNS = "auto-cols-fr grid-flow-col";

/** The engine's best line from before the move, and its best reply to the move played. */
function EngineLinesSection({
  move,
  moves,
  parentNodeId,
  onGoToLine
}: {
  move: MoveReview;
  moves: readonly MoveReview[];
  parentNodeId: string | null;
  onGoToLine?: GoToLine;
}) {
  const bestLine = useMemo(() => uciLineToSan(move.fenBefore, move.bestLine), [move]);
  const replyLine = useMemo(
    () =>
      move.terminal ? [] : uciLineToSan(move.fenAfter, replyLineUcis(move, moves)).slice(0, 8),
    [move, moves]
  );
  return (
    <>
      <section className="grid gap-1">
        <SectionHeader as="h3" title="Best line" className="min-h-0" />
        <p className="text-[0.8125rem] leading-6 text-fg-secondary">
          <MoveLine
            fen={move.fenBefore}
            startNodeId={parentNodeId}
            sans={bestLine}
            onGoToLine={onGoToLine}
            linkClassName="text-current hover:text-accent"
          />
        </p>
      </section>
      {replyLine.length && move.playedMove !== move.bestMove ? (
        <section className="grid gap-1">
          <SectionHeader as="h3" title="Best reply" className="min-h-0" />
          <p className="text-[0.8125rem] leading-6 text-fg-secondary">
            <MoveLine
              fen={move.fenAfter}
              startNodeId={move.nodeId}
              sans={replyLine}
              onGoToLine={onGoToLine}
              linkClassName="text-current hover:text-accent"
            />
          </p>
        </section>
      ) : null}
    </>
  );
}

/**
 * The candidate moves (Maia's at the user's level beside the engine's: its best only unless
 * alternatives are shown) and Maia's prediction across ratings (all five levels ran).
 */
function HumanAndEngine({
  move,
  showTopLines,
  userRating,
  parentNodeId,
  onGoToLine,
  running
}: {
  move: MoveReview;
  showTopLines: boolean;
  userRating: number;
  parentNodeId: string | null;
  onGoToLine?: GoToLine;
  running: boolean;
}) {
  const userBucket = quantizeToBucket(userRating);
  const annotation = move.assessment?.annotation ?? null;
  const usable = hasUsableMaiaData(move);
  const human = useMemo(() => humanMoveRows(move, userBucket), [move, userBucket]);
  const engine = useMemo(
    () => engineMoveRows(move, showTopLines ? move.topLines.length : 1),
    [move, showTopLines]
  );
  const lines = useMemo(
    () => (usable ? predictionLines(move, buildRatingCurveForMove(move, userRating)) : []),
    [move, usable, userRating]
  );
  const maiaHint = useOnboardingHint("maia-curve", usable && !running);
  // The best move alone, with no human moves beside it, is already in the facts above.
  const tables = human.length > 0 || engine.length > 1;
  return (
    <>
      {tables ? (
        <CandidateMoves
          human={human}
          engine={engine}
          userBucket={userBucket}
          annotation={annotation}
          parentNodeId={parentNodeId}
          onGoToLine={onGoToLine}
        />
      ) : null}
      {lines.length ? (
        <>
          {maiaHint.visible ? (
            <Coachmark onDismiss={maiaHint.dismiss}>
              Maia is trained on human games. These lines show how often players at each rating
              would play the move played, the best move and Maia&apos;s own pick; yours is shaded.
            </Coachmark>
          ) : null}
          <RatingCurve
            lines={lines}
            userBucket={userBucket}
            annotation={annotation}
            parentNodeId={parentNodeId}
            onGoToLine={onGoToLine}
          />
        </>
      ) : null}
    </>
  );
}

/** The tactical facts and engine signals the review found for the move, as chips. */
function Evidence({ move }: { move: MoveReview }) {
  const facts = useMemo(() => buildTacticalFacts(move), [move]);
  const signals = useMemo(() => buildEngineSignals(move), [move]);
  if (!facts.length && !signals.length) return null;
  return (
    <section className="grid gap-2">
      <SectionHeader as="h3" title="Evidence" className="min-h-0" />
      <div className="flex flex-wrap gap-1.5">
        {facts.map((fact, index) => (
          <Badge key={`fact-${index}`} tone="accent">
            {fact.kind}
            <span className="font-mono">{factSquare(fact)}</span>
          </Badge>
        ))}
        {signals.map((signal, index) => (
          <Badge key={`signal-${index}`} tone="info">
            {signal.kind.replaceAll("_", " ")}
          </Badge>
        ))}
      </div>
    </section>
  );
}

/** Where the played move ranked among the engine's candidates ("1 of 3"; "—" outside them). */
function formatRank(move: MoveReview): string {
  const rank = move.playedRank ?? null;
  return rank === null ? "—" : `${rank} of ${move.topLines.length}`;
}

/** The mover's winning chances before (best play) and after the move: "62% → 41%". */
function formatChances(move: MoveReview): string {
  const before = move.assessment?.winBefore;
  const after = move.assessment?.winAfter;
  if (before === null || before === undefined || after === null || after === undefined) return "—";
  return `${Math.round(before)}% → ${Math.round(after)}%`;
}

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
