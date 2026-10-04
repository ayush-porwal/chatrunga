import { z } from "zod";
import {
  commentaryDetailSchema,
  evalAssessmentSchema,
  ideaFactsSchema,
  sanTokenSchema,
  sideSchema
} from "./review-insight";

/**
 * Grounded facts for explaining one finished puzzle ("Explain with AI" on the puzzle card). The
 * renderer builds it from the puzzle, the attempt and a short engine pass; the main process
 * validates it before sending it to OpenRouter. Built per request and never persisted.
 */

const moveNumberSanSchema = z.string().regex(/^\d+\.(\.\.)?$/);

/**
 * How the attempt ended: solved cleanly, failed by a wrong move (the first one is explained), or
 * failed only because the solution was opened before it was found.
 */
export const puzzleOutcomeKindSchema = z.enum([
  "solved",
  "failed_wrong_move",
  "failed_solution_viewed"
]);

export type PuzzleOutcomeKind = z.infer<typeof puzzleOutcomeKindSchema>;

/** How much a wrong move gave away, from the solver's point of view (no numbers for the coach). */
export const puzzleSwingSchema = z.enum(["small", "moderate", "large", "decisive"]);

export type PuzzleSwing = z.infer<typeof puzzleSwingSchema>;

/** One engine candidate in the puzzle's start position. */
const puzzleCandidateSchema = z.object({
  rank: z.number().int().min(1).max(5),
  san: sanTokenSchema,
  lineSan: z.array(sanTokenSchema).max(8),
  assessment: evalAssessmentSchema.optional()
});

export const puzzleInsightPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    player: z.object({ rating: z.number().int().min(100).max(3500) }),
    puzzle: z.object({
      /** The start position; the solver ("you") is to move. */
      fen: z.string().min(10).max(128),
      sideToMove: sideSchema,
      /** Move number of the solver's first move ("24." / "24..."). */
      moveNumberSan: moveNumberSanSchema,
      rating: z.number().int().min(100).max(4000).optional(),
      /** Readable theme labels ("fork", "mate in 2"). */
      themes: z.array(z.string().min(1).max(40)).max(12),
      opening: z.string().min(1).max(100).optional(),
      /** The whole solution: the solver's moves and the forced replies, solver first. */
      solutionSan: z.array(sanTokenSchema).min(1).max(40)
    }),
    outcome: puzzleOutcomeKindSchema,
    /** The engine's reading of the start position. All assessments are White's point of view. */
    engine: z.object({
      engineName: z.string().min(1).max(60).optional(),
      assessment: evalAssessmentSchema,
      bestMoveSan: sanTokenSchema,
      bestLineSan: z.array(sanTokenSchema).min(1).max(10),
      alternatives: z.array(puzzleCandidateSchema).max(4).optional()
    }),
    /** The first wrong move (outcome `failed_wrong_move` only). */
    mistake: z
      .object({
        moveNumberSan: moveNumberSanSchema,
        san: sanTokenSchema,
        /** Solution moves already played correctly before it (solver and replies). */
        playedBeforeSan: z.array(sanTokenSchema).max(40),
        /** What the solution plays there. */
        solutionSan: sanTokenSchema,
        fenBefore: z.string().min(10).max(128),
        fenAfter: z.string().min(10).max(128),
        /**
         * The wrong move ended the game: `checkmate` (it mates too — the puzzle expected another
         * line), `stalemate` or `draw` (it throws the win away). There is no reply to refute it then.
         */
        ends: z.enum(["checkmate", "stalemate", "draw"]).optional(),
        /**
         * The opponent's best line after the wrong move (its first move is the answer it allows);
         * empty when it `ends` the game.
         */
        refutationSan: z.array(sanTokenSchema).max(10),
        assessmentBefore: evalAssessmentSchema.optional(),
        assessmentAfter: evalAssessmentSchema.optional(),
        swing: puzzleSwingSchema.optional(),
        /** The solver is still clearly better after it: the move isn't losing, the solution is just stronger. */
        stillWinning: z.boolean().optional()
      })
      .optional(),
    /**
     * Board-derived ideas at the decision position: the start position (played = the solution's
     * first move) or, after a wrong move, the position it was played from (played = the wrong move,
     * best = the solution move, reply = the refutation's first move).
     */
    ideas: ideaFactsSchema.optional(),
    commentaryDetail: commentaryDetailSchema.optional()
  })
  // A wrong move is explained exactly when the attempt failed by one.
  .refine((payload) => (payload.outcome === "failed_wrong_move") === Boolean(payload.mistake), {
    message: "mistake is required for failed_wrong_move, and only then",
    path: ["mistake"]
  })
  // A move that ended the game allows no reply.
  .refine((payload) => !payload.mistake?.ends || !payload.mistake.refutationSan.length, {
    message: "a mistake that ends the game has no refutation",
    path: ["mistake", "refutationSan"]
  });

export type PuzzleInsightPayload = z.infer<typeof puzzleInsightPayloadSchema>;
