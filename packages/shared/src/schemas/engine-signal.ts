import { z } from "zod";

/**
 * Engine-derived signals — things humans miss but the engine records. Derived
 * in the renderer (review-utils `buildEngineSignals`) from the MultiPV lines
 * already in the review; no extra engine work.
 *
 * Sign convention: all *Cp values are centipawns from side-to-move's perspective.
 * Positive = good for side-to-move. So `secondBestLossCp: -200` means the
 * second-best line is 200cp WORSE than the best line.
 */

export const engineSignalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("forced_sequence"),
    lineLengthPly: z.number().int().min(5),
    secondBestLossCp: z.number().int().lte(-200)
  }),
  z.object({
    kind: z.literal("only_move"),
    nextBestLossCp: z.number().int().lte(-400)
  }),
  z.object({
    kind: z.literal("quiet_threat"),
    threatSan: z.string().min(2),
    threatMaterialCp: z.number().int().min(200)
  })
]);

export type EngineSignal = z.infer<typeof engineSignalSchema>;
