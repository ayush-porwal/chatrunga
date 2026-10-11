import { buildIdeaFacts } from "@chaturanga/shared/chess/move-ideas";
import { fenAfterUci } from "@chaturanga/shared/chess/position";
import { scoreToCentipawns, terminalStateForFen } from "@chaturanga/shared/chess/review";
import type {
  PuzzleInsightPayload,
  PuzzleOutcomeKind,
  PuzzleSwing
} from "@chaturanga/shared/schemas/puzzle-insight";
import type { PuzzleSample } from "@chaturanga/shared/types/database";
import type {
  AnalysePositionInput,
  AnalysisLine,
  EngineConfig,
  EngineScore
} from "@chaturanga/shared/types/engine";
import type { AppSettings } from "@chaturanga/shared/types/settings";
import type { PuzzleOutcome, PuzzleWrongMove } from "../../stores/puzzle-store";
import { pickDefaultEngine } from "../game-review/review-engine-picker";
import { assessScore, uciLineToSan, uciToSan } from "../game-review/review-utils";
import { formatPuzzleTag } from "./puzzle-set";

/**
 * "Explain with AI" on the puzzle card: which case a finished attempt is, what the engine searches
 * for it, and the grounded facts sent to the coach (packages/shared/src/llm/puzzle-explanation.ts).
 */

/**
 * The case to explain, or null while the puzzle is still pending or its data turned out broken —
 * "void", or failed by the solver and broken after (its scripted line can't be trusted then).
 * Nothing is offered in those cases.
 */
export function explainOutcome(
  outcome: PuzzleOutcome,
  wrongMove: PuzzleWrongMove | null,
  broken = false
): PuzzleOutcomeKind | null {
  if (broken || outcome === "pending" || outcome === "void") return null;
  if (outcome === "solved") return "solved";
  return wrongMove ? "failed_wrong_move" : "failed_solution_viewed";
}

/**
 * Which puzzle this is across databases: a puzzle's id is its source row's, so two databases can
 * both have a puzzle with the same id.
 */
export function puzzleIdentity(puzzle: Pick<PuzzleSample, "databaseId" | "id">): string {
  return JSON.stringify([puzzle.databaseId, puzzle.id]);
}

/**
 * The session cache key: the puzzle ({@link puzzleIdentity}), how it went and, after a wrong move,
 * which one — a later try at the same puzzle with another mistake is explained afresh.
 */
export function explanationKey(
  puzzle: Pick<PuzzleSample, "databaseId" | "id">,
  kind: PuzzleOutcomeKind,
  wrong: PuzzleWrongMove | null
): string {
  const identity = puzzleIdentity(puzzle);
  return kind === "failed_wrong_move" && wrong
    ? `${identity}:${kind}:${wrong.solutionIndex}:${wrong.uci}`
    : `${identity}:${kind}`;
}

/** The Game review evaluation engine: the chosen one, else the automatic pick; null when unusable. */
export function explainEngine(
  engines: readonly EngineConfig[],
  defaultEngineId: string | null
): EngineConfig | null {
  const engine = defaultEngineId
    ? engines.find((item) => item.id === defaultEngineId)
    : pickDefaultEngine(engines);
  return engine?.isAvailable && !engine.isHumanPrediction ? engine : null;
}

/** Where each searched position's lines are in the analysis result. */
export type ExplainSearchPlan = {
  positions: AnalysePositionInput[];
  start: number;
  /** The position the wrong move was played from (the start itself when it was the first move). */
  beforeMistake: number | null;
  afterMistake: number | null;
};

/**
 * The start position with the review's line count; after a wrong move also the position it was
 * played from (when that isn't the start) and the one it left, one line each.
 */
export function explainSearchPlan(
  puzzle: PuzzleSample,
  wrong: PuzzleWrongMove | null,
  multipv: number
): ExplainSearchPlan {
  const positions: AnalysePositionInput[] = [
    { fen: puzzle.initialFen, multipv: Math.max(1, Math.min(multipv, 5)) }
  ];
  const plan: ExplainSearchPlan = { positions, start: 0, beforeMistake: null, afterMistake: null };
  const after = wrong ? fenAfterUci(wrong.fen, wrong.uci) : null;
  if (!wrong || !after) return plan;
  if (wrong.fen === puzzle.initialFen) plan.beforeMistake = 0;
  else plan.beforeMistake = positions.push({ fen: wrong.fen, multipv: 1 }) - 1;
  plan.afterMistake = positions.push({ fen: after, multipv: 1 }) - 1;
  return plan;
}

/** "24." with White to move, "24..." with Black. */
function moveNumberSan(fen: string): string {
  const [, turn = "w", , , , fullmove = "1"] = fen.split(" ");
  return `${Number(fullmove) || 1}.${turn === "b" ? ".." : ""}`;
}

/** The solver's centipawns (mates clamped to ±1000) from a White-perspective score. */
function solverCp(score: EngineScore, solver: "white" | "black"): number {
  const cp = Math.max(-1000, Math.min(1000, scoreToCentipawns(score)));
  return solver === "white" ? cp : -cp;
}

/** How much a wrong move gave away, in words: a win thrown away is decisive whatever the numbers. */
export function swingFor(before: number, after: number): PuzzleSwing {
  const loss = before - after;
  if (loss >= 300 || (before >= 200 && after < 100)) return "decisive";
  if (loss >= 150) return "large";
  if (loss >= 50) return "moderate";
  return "small";
}

/** The searched lines the payload is built from (see {@link explainSearchPlan}). */
export type ExplainAnalysis = {
  engineName: string;
  start: readonly AnalysisLine[];
  beforeMistake: readonly AnalysisLine[] | null;
  afterMistake: readonly AnalysisLine[] | null;
};

export type ExplainPayloadInput = {
  puzzle: PuzzleSample;
  kind: PuzzleOutcomeKind;
  wrong: PuzzleWrongMove | null;
  analysis: ExplainAnalysis;
  settings: Pick<AppSettings, "playerRatings" | "reviewCommentaryDetail">;
};

/**
 * The engine's read of the start position: its verdict, best line, and the other lines (null
 * without one).
 */
function startPositionFacts(fen: string, analysis: ExplainAnalysis) {
  const best = analysis.start.at(0);
  const bestLineSan = best ? uciLineToSan(fen, best.pv).slice(0, 10) : [];
  const assessment = assessScore(best?.scoreWhite);
  if (!best || !bestLineSan.length || !assessment) return null;
  const alternatives = analysis.start.slice(1, 5).flatMap((line) => {
    const lineSan = uciLineToSan(fen, line.pv).slice(0, 8);
    return lineSan.length
      ? [{ rank: line.multipv, san: lineSan[0], lineSan, assessment: assessScore(line.scoreWhite) }]
      : [];
  });
  return {
    engineName: analysis.engineName.slice(0, 60) || undefined,
    assessment,
    bestMoveSan: bestLineSan[0],
    bestLineSan,
    alternatives: alternatives.length ? alternatives : undefined
  };
}

/**
 * The puzzle itself: its position, its rating when plausible, its themes and opening, the solution.
 */
function puzzleFacts(puzzle: PuzzleSample, solutionSan: string[]) {
  const fen = puzzle.initialFen;
  const opening = puzzle.openingTags.at(0);
  return {
    fen,
    sideToMove: puzzle.sideToMove,
    moveNumberSan: moveNumberSan(fen),
    rating:
      puzzle.rating && puzzle.rating >= 100 && puzzle.rating <= 4000
        ? Math.round(puzzle.rating)
        : undefined,
    themes: puzzle.themes
      .map(formatPuzzleTag)
      .filter((theme) => theme.length <= 40)
      .slice(0, 12),
    opening: opening ? formatPuzzleTag(opening).slice(0, 100) : undefined,
    solutionSan
  };
}

/** The ideas behind the wrong move against the solution's (`mistake`), else behind the solution. */
function puzzleIdeas(
  puzzle: PuzzleSample,
  wrong: PuzzleWrongMove | null,
  mistake: ReturnType<typeof buildMistake>,
  analysis: ExplainAnalysis
) {
  if (!mistake || !wrong)
    return buildIdeaFacts({
      fenBefore: puzzle.initialFen,
      playedUci: puzzle.solutionMoves[0],
      bestUci: puzzle.solutionMoves[0],
      bestLine: puzzle.solutionMoves
    });
  return buildIdeaFacts({
    fenBefore: wrong.fen,
    playedUci: wrong.uci,
    bestUci: wrong.expectedUci,
    bestLine: puzzle.solutionMoves.slice(wrong.solutionIndex),
    replyLine: mistake.ends ? undefined : analysis.afterMistake?.[0]?.pv
  });
}

/**
 * The coach's facts for a finished puzzle, or null when they can't be grounded (the solution
 * doesn't replay, or the engine returned no line for the start position). Checked against the
 * schema main validates with, so what is returned is what main accepts.
 */
export async function buildPuzzleExplanationPayload({
  puzzle,
  kind,
  wrong,
  analysis,
  settings
}: ExplainPayloadInput): Promise<PuzzleInsightPayload | null> {
  const solutionSan = uciLineToSan(puzzle.initialFen, puzzle.solutionMoves);
  if (solutionSan.length !== puzzle.solutionMoves.length || !solutionSan.length) return null;
  const engine = startPositionFacts(puzzle.initialFen, analysis);
  if (!engine) return null;
  const failedOnMove = kind === "failed_wrong_move";
  const mistake =
    failedOnMove && wrong ? buildMistake(puzzle, wrong, solutionSan, analysis) : undefined;
  if (failedOnMove && !mistake) return null;
  const ideas = puzzleIdeas(puzzle, wrong, mistake, analysis);

  // The schema (and zod with it) loads with the first explanation asked for, not at startup.
  const { puzzleInsightPayloadSchema } = await import("@chaturanga/shared/schemas/puzzle-insight");
  const parsed = puzzleInsightPayloadSchema.safeParse({
    schemaVersion: 1,
    // A puzzle has no time control: the rapid rating, as a review of a game without one.
    player: { rating: settings.playerRatings.rapid.rating },
    puzzle: puzzleFacts(puzzle, solutionSan),
    outcome: kind,
    engine,
    mistake,
    ideas: ideas ?? undefined,
    commentaryDetail: settings.reviewCommentaryDetail
  });
  return parsed.success ? parsed.data : null;
}

type Mistake = NonNullable<PuzzleInsightPayload["mistake"]>;

function buildMistake(
  puzzle: PuzzleSample,
  wrong: PuzzleWrongMove,
  solutionSan: readonly string[],
  analysis: ExplainAnalysis
): Mistake | undefined {
  const fenAfter = fenAfterUci(wrong.fen, wrong.uci);
  const san = uciToSan(wrong.fen, wrong.uci);
  const expected = uciToSan(wrong.fen, wrong.expectedUci);
  if (!fenAfter || !san || !expected) return undefined;
  const solver = puzzle.sideToMove;
  const beforeScore = analysis.beforeMistake?.[0]?.scoreWhite ?? null;
  const before = beforeScore ? solverCp(beforeScore, solver) : null;
  const common = {
    moveNumberSan: moveNumberSan(wrong.fen),
    san,
    playedBeforeSan: solutionSan.slice(0, wrong.solutionIndex),
    solutionSan: expected,
    fenBefore: wrong.fen,
    fenAfter,
    assessmentBefore: assessScore(beforeScore)
  };
  const terminal = terminalStateForFen(fenAfter);
  if (terminal) return endingMistake(common, terminal, solver, before);
  return refutedMistake(common, analysis.afterMistake?.[0], solver, before);
}

/** A wrong move the engine refutes: its line, and how much the move gave away. */
function refutedMistake(
  common: Omit<Mistake, "refutationSan">,
  refutation: AnalysisLine | undefined,
  solver: "white" | "black",
  before: number | null
): Mistake {
  const afterScore = refutation?.scoreWhite ?? null;
  const after = afterScore ? solverCp(afterScore, solver) : null;
  return {
    ...common,
    refutationSan: refutation ? uciLineToSan(common.fenAfter, refutation.pv).slice(0, 8) : [],
    assessmentAfter: assessScore(afterScore),
    swing: before !== null && after !== null ? swingFor(before, after) : undefined,
    stillWinning: after !== null ? after >= 200 : undefined
  };
}

/**
 * A wrong move that ends the game has no reply to refute it: a mate wins all the same (the
 * puzzle wanted its own line), a stalemate or draw throws the win away on the spot.
 */
function endingMistake(
  common: Omit<Mistake, "refutationSan">,
  terminal: NonNullable<ReturnType<typeof terminalStateForFen>>,
  solver: "white" | "black",
  before: number | null
): Mistake {
  if (terminal === "checkmate")
    return { ...common, ends: terminal, refutationSan: [], assessmentAfter: `${solver}_won` };
  return {
    ...common,
    ends: terminal,
    refutationSan: [],
    assessmentAfter: "draw",
    swing: before !== null ? swingFor(before, 0) : undefined,
    stillWinning: false
  };
}
