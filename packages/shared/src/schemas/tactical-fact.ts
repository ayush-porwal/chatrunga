import { z } from "zod";

/**
 * Structured tactical motifs detected by the tactics engine
 * (packages/shared/src/chess/tactics.ts): hanging, fork, pin and skewer.
 *
 * The renderer produces these facts from local engine analysis and the main
 * process validates them (inside the commentary payload) before calling the LLM.
 *
 * Square uses chessops algebraic notation: a1..h8 lowercase. PieceRole follows
 * chessops conventions: "pawn" | "knight" | "bishop" | "rook" | "queen" | "king".
 */

const squareSchema = z
  .string()
  .regex(/^[a-h][1-8]$/, "Square must be lowercase algebraic, e.g. e4");

const pieceRoleSchema = z.enum(["pawn", "knight", "bishop", "rook", "queen", "king"]);

const pieceRefSchema = z.object({
  role: pieceRoleSchema,
  square: squareSchema
});

const valuedTargetSchema = pieceRefSchema.extend({
  value: z.number().int().positive()
});

export const tacticalFactSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("hanging"),
    piece: pieceRefSchema,
    attackedBy: z.array(squareSchema),
    defendedBy: z.array(squareSchema)
  }),
  z.object({
    kind: z.literal("fork"),
    attacker: pieceRefSchema,
    targets: z.array(valuedTargetSchema).min(2)
  }),
  z.object({
    kind: z.literal("pin"),
    pinned: pieceRefSchema,
    pinner: pieceRefSchema,
    behind: pieceRefSchema
  }),
  z.object({
    kind: z.literal("skewer"),
    attacker: pieceRefSchema,
    front: pieceRefSchema,
    behind: pieceRefSchema
  })
]);

export type TacticalFact = z.infer<typeof tacticalFactSchema>;
