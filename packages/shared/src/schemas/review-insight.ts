import { z } from "zod";
import { tacticalFactSchema } from "./tactical-fact";
import { engineSignalSchema } from "./engine-signal";
import { REVIEW_INSIGHT_PAYLOAD_VERSION } from "./constants";
import { ratingCurveSchema, maiaRatingSchema } from "./rating-curve";

/**
 * Structured engine evidence supplied to the coach for one move. The renderer
 * builds it from the finished review; the main process validates it before
 * sending it to OpenRouter.
 */

export const sanTokenSchema = z
  .string()
  .min(2)
  .max(10)
  .regex(/^O-O(-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](=[QRBN])?[+#]?$/);

const evalScoreSchema = z
  .string()
  .regex(/^[+-]?\d+(\.\d+)?$|^M[+-]?\d+$/, "Eval must be like +0.4 or M-3");

/**
 * Why the move is being explained. The payload is built per request and never
 * persisted, so only the reasons the renderer emits are accepted.
 */
const curatorReasonSchema = z.enum(["mistake", "move_review", "difficult_find"]);

export type CuratorReason = z.infer<typeof curatorReasonSchema>;

/**
 * The review's mark for a move (chess/move-assessment.ts). Most moves have none (null): the coach
 * explains them without a verdict.
 */
const moveAnnotationSchema = z.enum([
  "book",
  "brilliant",
  "great",
  "excellent",
  "good",
  "miss",
  "inaccuracy",
  "mistake",
  "blunder"
]);

const errorSeveritySchema = z.enum(["inaccuracy", "mistake", "blunder"]);

/** The assessment's evidence (AssessmentTag): the only grounds for calling a move special. */
const assessmentTagSchema = z.enum([
  "engine_top",
  "only_move",
  "sacrifice",
  "punishes_error",
  "missed_chance",
  "missed_tactic",
  "saves_material",
  "tactic",
  "hard_to_find",
  "natural_move",
  "forced",
  "recapture",
  "book",
  "decided",
  "mate_created",
  "mate_lost",
  "unverified",
  "unstable",
  "incomplete"
]);

export const sideSchema = z.enum(["white", "black"]);
const moveNumberSanSchema = z.string().regex(/^\d+\.(\.\.)?$/);

/**
 * Verbal reading of a White-perspective evaluation, so the coach can describe
 * the position without quoting numbers. "*_won" / "draw" describe a finished
 * game (checkmate, stalemate, insufficient material).
 */
export const evalAssessmentSchema = z.enum([
  "equal",
  "white_slightly_better",
  "white_clearly_better",
  "white_winning",
  "white_has_forced_mate",
  "white_won",
  "black_slightly_better",
  "black_clearly_better",
  "black_winning",
  "black_has_forced_mate",
  "black_won",
  "draw"
]);

export type EvalAssessment = z.infer<typeof evalAssessmentSchema>;

export const commentaryDetailSchema = z.enum(["concise", "balanced", "detailed"]);

/** One engine candidate in the position before the move (MultiPV line). */
const engineAlternativeSchema = z.object({
  rank: z.number().int().min(1).max(5),
  san: sanTokenSchema,
  eval: evalScoreSchema,
  lineSan: z.array(sanTokenSchema).max(6),
  isPlayed: z.boolean().optional()
});

/** Win/draw/loss chances in whole percent, from the MOVER's point of view. */
const winChanceSchema = z.object({
  win: z.number().int().min(0).max(100),
  draw: z.number().int().min(0).max(100),
  loss: z.number().int().min(0).max(100)
});

const humanLikelihoodSchema = z.enum(["most_likely", "common", "plausible", "unusual", "rare"]);

const probabilitySchema = z.number().min(0).max(1);
const policyRankSchema = z.number().int().min(1).max(300);

/**
 * Maia's reading of the move at one rating (reviews with schemaVersion >= 2 only): how likely
 * humans of that rating are to play the played / best move, and what they play most.
 */
const maiaEvidenceSchema = z.object({
  /**
   * maia3: one model read at a rating 600-2600 (the mover's, as both players' rating); maia1: the
   * five networks (1100-1900) of reviews before Maia 3, read at the level nearest the player's.
   */
  model: z.enum(["maia3", "maia1"]),
  rating: maiaRatingSchema,
  playedProb: probabilitySchema.optional(),
  playedRank: policyRankSchema.optional(),
  playedLikelihood: humanLikelihoodSchema.optional(),
  /** Only when the best move isn't the played one. */
  bestProb: probabilitySchema.optional(),
  bestRank: policyRankSchema.optional(),
  bestLikelihood: humanLikelihoodSchema.optional(),
  /** Maia's most likely moves at `rating` (absent when its distribution is flat). */
  topMoves: z
    .array(z.object({ san: sanTokenSchema, prob: probabilitySchema }))
    .min(1)
    .max(3)
    .optional(),
  /**
   * Maia 3: White's chances (win + half a draw, whole percent) in games between players of
   * `rating` from the position before the move. A prediction of human results, not an evaluation.
   */
  whiteWinPct: z.number().int().min(0).max(100).optional()
});

const factTextSchema = z.string().min(1).max(240);

/** Deterministic "what the move does" statements (packages/shared/src/chess/move-ideas.ts). */
const moveIdeaSchema = z.object({
  san: sanTokenSchema,
  facts: z.array(factTextSchema).max(8)
});

const positionSnapshotSchema = z.object({
  material: z.string().min(1).max(200),
  white: z.string().max(400),
  black: z.string().max(400),
  files: z.string().max(160).optional(),
  center: z.string().max(120).optional()
});

/**
 * Board-derived ideas: piece placement, what the played / best / reply moves
 * do in chess terms, and a positional snapshot before and after the move.
 */
export const ideaFactsSchema = z.object({
  board: z.object({ white: z.string().min(3).max(200), black: z.string().min(3).max(200) }),
  played: moveIdeaSchema,
  best: moveIdeaSchema.optional(),
  reply: moveIdeaSchema.optional(),
  position: z
    .object({
      /** Only the fields that differ from `after`. */
      before: positionSnapshotSchema.partial(),
      after: positionSnapshotSchema,
      changes: z.array(factTextSchema).max(6).optional()
    })
    .optional()
});

export type IdeaFactsPayload = z.infer<typeof ideaFactsSchema>;

/** A preceding ply, oldest first, for game-flow context. */
const recentMoveSchema = z.object({
  moveNumberSan: moveNumberSanSchema,
  san: sanTokenSchema,
  mover: sideSchema,
  annotation: moveAnnotationSchema.optional(),
  evalAfter: evalScoreSchema.optional()
});

const mistakeCountSchema = z.object({
  inaccuracies: z.number().int().min(0).max(600),
  mistakes: z.number().int().min(0).max(600),
  blunders: z.number().int().min(0).max(600)
});

/**
 * Everything beyond the single move: history, what happened next, headers.
 * Every field is optional so thin reviews still produce a valid payload
 * (the schema is non-strict and strips unknown keys).
 */
const reviewInsightContextSchema = z.object({
  players: z
    .object({
      white: z.string().min(1).max(60).optional(),
      black: z.string().min(1).max(60).optional()
    })
    .optional(),
  event: z.string().min(1).max(80).optional(),
  opening: z.string().min(1).max(100).optional(),
  timeControl: z.string().min(1).max(20).optional(),
  result: z.enum(["1-0", "0-1", "1/2-1/2"]).optional(),
  totalPlies: z.number().int().min(1).max(1200).optional(),
  recentMoves: z.array(recentMoveSchema).max(8).optional(),
  trend: z.enum(["stable", "white_improving", "black_improving", "swinging"]).optional(),
  mistakesSoFar: z.object({ white: mistakeCountSchema, black: mistakeCountSchema }).optional(),
  actualReply: z
    .object({
      moveNumberSan: moveNumberSanSchema,
      san: sanTokenSchema,
      annotation: moveAnnotationSchema.optional(),
      matchesEngine: z.boolean()
    })
    .optional()
});

export { REVIEW_INSIGHT_PAYLOAD_VERSION } from "./constants";

export const reviewInsightPayloadSchema = z.object({
  schemaVersion: z.literal(REVIEW_INSIGHT_PAYLOAD_VERSION),
  player: z.object({
    rating: z.number().int().min(100).max(3500),
    color: sideSchema
  }),
  game: z.object({
    ply: z.number().int().min(1),
    moveNumberSan: moveNumberSanSchema,
    san: sanTokenSchema,
    mover: sideSchema.optional(),
    fenBefore: z.string().min(10),
    fenAfter: z.string().min(10),
    phase: z.enum(["opening", "middlegame", "endgame"]),
    givesCheck: z.boolean().optional(),
    /** Set when the played move ended the game. */
    terminal: z.enum(["checkmate", "stalemate", "insufficient_material"]).optional()
  }),
  engines: z.object({
    stockfish: z.object({
      evalBefore: evalScoreSchema,
      evalAfter: evalScoreSchema,
      evalLossCp: z.number().int().min(0),
      bestMoveSan: sanTokenSchema,
      bestLineSan: z.array(sanTokenSchema).min(1).max(8),
      /** All evals in this object are White-perspective. */
      evalPerspective: z.literal("white").optional(),
      bestEvalAfter: evalScoreSchema.optional(),
      assessment: z
        .object({
          before: evalAssessmentSchema,
          after: evalAssessmentSchema,
          afterBest: evalAssessmentSchema.optional()
        })
        .optional(),
      alternatives: z.array(engineAlternativeSchema).max(3).optional(),
      /** 1-based MultiPV rank of the played move, when it was one of the candidates. */
      playedMoveRank: z.number().int().min(1).max(5).optional(),
      /** Engine's best continuation from fenAfter (opponent to move). */
      replyLineSan: z.array(sanTokenSchema).min(1).max(8).optional(),
      /** Which engine produced this evidence (the key stays "stockfish" for wire compatibility). */
      engineName: z.string().min(1).max(60).optional(),
      depth: z.number().int().min(1).max(250).optional(),
      moveTimeMs: z.number().int().min(1).max(3_600_000).optional(),
      /** Engine WDL converted to the mover's win/draw/loss percent. */
      winChance: z
        .object({ before: winChanceSchema.optional(), after: winChanceSchema.optional() })
        .optional()
    }),
    maia: maiaEvidenceSchema.optional(),
    /** Maia's probabilities of the played and best moves by rating, when the move has a curve. */
    maiaCurve: ratingCurveSchema.optional()
  }),
  /** The review's mark for the move; null for an ordinary, unmarked move. */
  annotation: moveAnnotationSchema.nullable(),
  /** How damaging the move was, when it was an error (marked or not). */
  severity: errorSeveritySchema.optional(),
  /** The facts behind the mark (or the absence of one). */
  assessmentTags: z.array(assessmentTagSchema).max(19).optional(),
  curatorReason: curatorReasonSchema,
  tacticalFacts: z.array(tacticalFactSchema),
  engineSignals: z.array(engineSignalSchema),
  /** Coarse motif labels for the engine's best move (e.g. "fork", "capture"). */
  bestMoveMotifs: z.array(z.string().min(1).max(30)).max(6).optional(),
  clock: z
    .object({
      moverRemainingSec: z.number().int().min(0).max(86_400).optional(),
      moverSpentSec: z.number().int().min(0).max(86_400).optional(),
      opponentRemainingSec: z.number().int().min(0).max(86_400).optional()
    })
    .optional(),
  context: reviewInsightContextSchema.optional(),
  /** Board-derived ideas behind the played and best moves. */
  ideas: ideaFactsSchema.optional(),
  commentaryDetail: commentaryDetailSchema.optional()
});

export type ReviewInsightPayload = z.infer<typeof reviewInsightPayloadSchema>;
