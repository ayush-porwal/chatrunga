import { useCallback, useEffect, useMemo } from "react";
import { Cpu } from "lucide-react";
import type { Color } from "@chaturanga/shared/types/chess";
import type { MoveReview } from "@chaturanga/shared/types/engine";
import type { TacticalFact } from "@chaturanga/shared/schemas";
import { formatMillisecondsDuration } from "@chaturanga/shared/chess/clock-display";
import {
  buildEngineSignals,
  buildTacticalFacts,
  hasUsableMaiaData,
  uciLineToSan,
  uciToSan
} from "./review-utils";
import { formatMoveEval, moverWinChances } from "./review-score";
import { RatingCurve, RatingCurveFrame } from "./RatingCurve";
import { CandidateMoves } from "./CandidateMoves";
import { MaiaDownloadPrompt } from "./MaiaDownloadPrompt";
import {
  engineMoveRows,
  humanMoveRows,
  predictionCurve,
  tablePrediction,
  type PredictionCurve
} from "./rating-curve-chart";
import { moverOf } from "./review-summary";
import { curveRequest, markedRating, type MaiaCurveSource } from "./maia-curve-source";
import { useMaia3Installed, useMaiaCurveQuery } from "../../queries/maia";
import { useReviewStore } from "../../stores/review-store";
import { ipcErrorMessage } from "@/lib/ipc-error";
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
  reviewedSide,
  evalEngine,
  maiaCurveSource,
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
  /** The side the game is reviewed as ("You" on the curve when it moved). */
  reviewedSide: Color;
  /** The display name of the engine the review's evaluations are from (null: unknown). */
  evalEngine: string | null;
  /** The saved Maia 3 review a move's curve is read for, and its side ratings (null: none, or not saved yet). */
  maiaCurveSource: MaiaCurveSource | null;
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
      <MoveFacts move={move} reviewedSide={reviewedSide} />
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
        reviewedSide={reviewedSide}
        evalEngine={evalEngine}
        curveSource={maiaCurveSource}
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
 * The move's facts, as Analyze's engine strip: Played / Best / Eval / Loss, then the mover's
 * winning chances ("Your chances" for the reviewed side's move, "Opponent's chances" otherwise) /
 * Engine rank / Time (when the game recorded it).
 */
function MoveFacts({ move, reviewedSide }: { move: MoveReview; reviewedSide: Color }) {
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
        <StatCell
          label={moverOf(move) === reviewedSide ? "Your chances" : "Opponent's chances"}
          size="sm"
        >
          {formatChances(move)}
        </StatCell>
        <StatCell label="Engine rank" size="sm">
          {formatRank(move)}
        </StatCell>
        {move.timeSpentMs === undefined ? null : (
          <StatCell label="Time" size="sm">
            {formatMillisecondsDuration(move.timeSpentMs)}
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
 * The candidate moves (Maia's beside the engine's: its best only unless alternatives are shown)
 * and Maia's prediction across ratings. Maia 3: its moves at the mover's rating, and the curve over
 * its 21 ratings, saved with the move or read once when the move is first shown (`curveSource`).
 * Maia 1: its moves at the level nearest the user's rating, and the curve over its five levels.
 * Without any Maia data and without Maia 3 installed, the download is offered in their place.
 */
function HumanAndEngine({
  move,
  showTopLines,
  userRating,
  reviewedSide,
  evalEngine,
  curveSource,
  parentNodeId,
  onGoToLine,
  running
}: {
  move: MoveReview;
  showTopLines: boolean;
  userRating: number;
  reviewedSide: Color;
  evalEngine: string | null;
  curveSource: MaiaCurveSource | null;
  parentNodeId: string | null;
  onGoToLine?: GoToLine;
  running: boolean;
}) {
  const annotation = move.assessment?.annotation ?? null;
  // Maia 3 reads the mover at their rating; Maia 1 the user at the nearest of its levels.
  const marked = markedRating(move, curveSource, userRating);
  const maia3 = Boolean(move.moverPrediction) || curveSource !== null;
  const markLabel = !maia3 || moverOf(move) === reviewedSide ? "You" : "Opponent";
  const tableSource = tablePrediction(move, marked);
  const human = useMemo(() => humanMoveRows(move, tableSource), [move, tableSource]);
  const engine = useMemo(
    () => engineMoveRows(move, showTopLines ? move.topLines.length : 1),
    [move, showTopLines]
  );
  // The best move alone, with no human moves beside it, is already in the facts above.
  const tables = human.length > 0 || engine.length > 1;
  return (
    <>
      {tables ? (
        <CandidateMoves
          human={human}
          engine={engine}
          humanRating={tableSource?.rating ?? marked}
          engineName={evalEngine}
          annotation={annotation}
          parentNodeId={parentNodeId}
          onGoToLine={onGoToLine}
        />
      ) : null}
      <HumanCurve
        move={move}
        marked={marked}
        markLabel={markLabel}
        source={running ? null : curveSource}
        running={running}
        parentNodeId={parentNodeId}
        onGoToLine={onGoToLine}
      />
    </>
  );
}

/**
 * Maia's prediction across ratings (with its first-time hint), a placeholder of its height while
 * Maia 3 reads it or when it couldn't (Maia 3's download when it isn't installed), or that download
 * alone in its place for a move without any Maia data.
 */
function HumanCurve({
  move,
  marked,
  markLabel,
  source,
  running,
  parentNodeId,
  onGoToLine
}: {
  move: MoveReview;
  marked: number;
  markLabel: string;
  source: MaiaCurveSource | null;
  running: boolean;
  parentNodeId: string | null;
  onGoToLine?: GoToLine;
}) {
  const curve = useMoveCurve(move, marked, source);
  const installed = useMaia3Installed();
  const maiaHint = useOnboardingHint("maia-curve", curve.status === "ready" && !running);
  if (curve.status === "loading")
    return <RatingCurveFrame placeholder="Maia is reading the move at every rating…" />;
  if (curve.status === "error")
    return (
      <RatingCurveFrame
        placeholder={
          installed === false ? (
            <MaiaDownloadPrompt variant="panel" />
          ) : (
            <span className="grid max-w-72 justify-items-center gap-2">
              {curve.message || "Maia couldn't read this move."}
              <Button variant="outline" size="sm" onClick={curve.retry}>
                Try again
              </Button>
            </span>
          )
        }
      />
    );
  if (curve.status === "none") {
    const noMaia = !move.moverPrediction && !move.humanPredictions?.length;
    return noMaia && installed === false && !running ? (
      <section className="rounded-[10px] border border-line bg-surface-sunken py-3">
        <MaiaDownloadPrompt variant="panel" />
      </section>
    ) : null;
  }
  return (
    <>
      {maiaHint.visible ? (
        <Coachmark onDismiss={maiaHint.dismiss}>
          Maia is trained on human games. These lines show how often players at each rating would
          play the move played, the best move and Maia&apos;s own pick; the rating the move was read
          at is shaded.
        </Coachmark>
      ) : null}
      <RatingCurve
        curve={curve.curve}
        marked={marked}
        markLabel={markLabel}
        annotation={move.assessment?.annotation ?? null}
        parentNodeId={parentNodeId}
        onGoToLine={onGoToLine}
      />
    </>
  );
}

type MoveCurve =
  | { status: "ready"; curve: PredictionCurve }
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | { status: "none" };

/**
 * The move's rating curve: the predictions it carries (Maia 1's levels, or a Maia 3 curve saved
 * with it), else for any move of a saved Maia 3 review (`source`) Maia 3's, read on demand once
 * (a move a partial Maia run missed too: see curveRequest).
 */
function useMoveCurve(move: MoveReview, marked: number, source: MaiaCurveSource | null): MoveCurve {
  // Maia 1's five levels, or a Maia 3 curve saved with the move (none during the run).
  const storedCurve = useMemo(
    () =>
      hasUsableMaiaData(move) && move.humanPredictions?.length
        ? predictionCurve(move, move.humanPredictions, marked)
        : null,
    [marked, move]
  );
  const input = curveRequest(source, move, storedCurve !== null);
  const query = useMaiaCurveQuery(input);
  // Into the shown review too, so the coach and the next visit read it without asking again.
  const read = query.data;
  const reviewId = input?.reviewId;
  const nodeId = move.nodeId;
  useEffect(() => {
    if (read && reviewId) useReviewStore.getState().setMoveCurve(reviewId, nodeId, read);
  }, [nodeId, read, reviewId]);
  const fetchedCurve = useMemo(
    () => (query.data ? predictionCurve(move, query.data, marked) : null),
    [marked, move, query.data]
  );
  const { refetch } = query;
  const retry = useCallback(() => void refetch(), [refetch]);
  const curve = storedCurve ?? fetchedCurve;
  if (curve) return { status: "ready", curve };
  // Pending: the move is resting before its curve is asked for, or Maia is reading it.
  if (query.isFetching || (input && query.isPending)) return { status: "loading" };
  if (query.isError) return { status: "error", message: ipcErrorMessage(query.error), retry };
  return { status: "none" };
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

/**
 * The mover's winning chances before and after the move, "62% → 41%": the evaluations of the
 * positions either side of it, as the Winning chances chart plots them.
 */
function formatChances(move: MoveReview): string {
  const chances = moverWinChances(move);
  return chances ? `${chances.before}% → ${chances.after}%` : "—";
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
