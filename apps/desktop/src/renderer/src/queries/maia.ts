import { useEffect, useState } from "react";
import { queryOptions, skipToken, useQuery } from "@tanstack/react-query";
import {
  MAIA_CURVE_NOT_SAVED,
  type MaiaCurveInput,
  type RatingPrediction
} from "@chaturanga/shared/types/engine";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { isRecord } from "@chaturanga/shared/types/guards";
import { isMaiaEngine } from "../features/play/engine-game";
import { useEnginesQuery } from "./api";

/**
 * Maia 3 for Game review: whether it is installed, and a reviewed move's rating curve (main reads it on demand, once per move, and saves it into the review).
 */
const maiaKeys = {
  curve: (input: MaiaCurveInput) =>
    ["maia", "curve", input.gameId, input.reviewId, input.nodeId] as const
};

/** Whether Maia 3 is installed (its managed engine is listed); null while the engines load. */
export function useMaia3Installed(): boolean | null {
  const engines = useEnginesQuery();
  if (!engines.data) return null;
  return engines.data.some((engine) => isMaiaEngine(engine) && engine.isAvailable);
}

/** How long a move must stay shown before its curve is asked for (stepping through moves asks none). */
const CURVE_REST_MS = 300;
/** Retries while the analysis isn't saved yet (the autosave writes it moments after it finishes). */
const NOT_SAVED_RETRIES = 12;

/**
 * Whether to ask for a curve again: only while main says the analysis isn't saved yet (any other
 * failure is final until Try again: Maia not installed, a model that failed to load).
 */
export function retryMaiaCurve(failures: number, error: unknown): boolean {
  return failures < NOT_SAVED_RETRIES && ipcErrorMessage(error) === MAIA_CURVE_NOT_SAVED;
}

/** The wait before asking again: 0.5 s, 1 s, then every 2 s. */
export function maiaCurveRetryDelay(failures: number): number {
  return Math.min(500 * 2 ** failures, 2_000);
}

/**
 * The curve query's options. Asked only once the move has rested (`rested`); a curve read before
 * is shown at once. An analysis not saved yet is asked again shortly (retryMaiaCurve).
 */
export function maiaCurveQueryOptions(input: MaiaCurveInput | null, rested: boolean) {
  return queryOptions({
    queryKey: input ? maiaKeys.curve(input) : (["maia", "curve", null] as const),
    queryFn:
      input && rested
        ? async () => {
            const api = window.chaturanga;
            if (!api) throw new Error("Maia needs the desktop app.");
            const curve = parseMaiaCurve(await api.engines.maiaCurve(input));
            if (!curve) throw new Error("Maia's answer couldn't be read.");
            return curve;
          }
        : skipToken,
    staleTime: Infinity,
    retry: retryMaiaCurve,
    retryDelay: maiaCurveRetryDelay
  });
}

/**
 * A reviewed move's 21-rating curve (Maia 3 at every rating from 600 to 2600), read once per move
 * of a saved review: kept for the session (main also saves it into the review, so it is in the
 * move's `humanPredictions` when the review is opened again). `input` null: nothing to read.
 * Asked for once the move has been shown for CURVE_REST_MS, so stepping through moves doesn't ask
 * for a curve per move passed (main also keeps only the newest waiting one); pending until then.
 */
export function useMaiaCurveQuery(input: MaiaCurveInput | null) {
  const key = input ? JSON.stringify(maiaKeys.curve(input)) : null;
  const [restedKey, setRestedKey] = useState<string | null>(null);
  useEffect(() => {
    if (key === null) return;
    const timer = window.setTimeout(() => setRestedKey(key), CURVE_REST_MS);
    return () => window.clearTimeout(timer);
  }, [key]);
  const rested = key !== null && restedKey === key;
  return useQuery(maiaCurveQueryOptions(input, rested));
}

/**
 * Main's curve, checked: predictions with a finite rating and top moves of a UCI move and a
 * probability, ascending by rating. Null for anything else.
 */
export function parseMaiaCurve(value: unknown): RatingPrediction[] | null {
  if (!Array.isArray(value)) return null;
  const predictions: RatingPrediction[] = [];
  for (const item of value) {
    if (!isRecord(item) || !finite(item.rating) || !Array.isArray(item.topMoves)) return null;
    const topMoves = item.topMoves.map((move: unknown) =>
      isRecord(move) && typeof move.uci === "string" && finite(move.prob)
        ? { uci: move.uci, prob: move.prob }
        : null
    );
    if (topMoves.some((move) => move === null)) return null;
    predictions.push({
      rating: item.rating,
      topMoves: topMoves.filter((move) => move !== null),
      ...(finite(item.playedProb) ? { playedProb: item.playedProb } : {}),
      ...(finite(item.bestProb) ? { bestProb: item.bestProb } : {}),
      ...(finite(item.whiteWinProb) ? { whiteWinProb: item.whiteWinProb } : {})
    });
  }
  return predictions.sort((a, b) => a.rating - b.rating);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
