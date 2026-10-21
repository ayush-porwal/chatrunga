import { fenAfterUci } from "@chaturanga/shared/chess/position";
import {
  MAIA3_DEFAULT_RATING,
  type Maia3Evaluator,
  type Maia3Query
} from "@chaturanga/shared/engine/maia3";
import { sampleMaia3Move } from "@chaturanga/shared/engine/maia3-host";
import type { StartEngineGameInput } from "@chaturanga/shared/types/engine";
import { maiaThinkMs } from "./think-time";

type GameMoveInput = Pick<StartEngineGameInput, "fen" | "moves" | "side" | "clock" | "maia">;

/**
 * The position Maia moves in (the start plus the game's moves) at Maia's rating (eloSelf)
 * against the user's (eloOppo). Without ratings (validate.ts snaps any it is given) Maia plays
 * at the default rating against an equal opponent.
 */
export function maiaGameQuery(input: Pick<GameMoveInput, "fen" | "moves" | "maia">): Maia3Query {
  let fen = input.fen;
  for (const uci of input.moves) {
    const next = fenAfterUci(fen, uci);
    if (!next) throw new Error(`The game has an illegal move (${uci}).`);
    fen = next;
  }
  const rating = input.maia?.rating ?? MAIA3_DEFAULT_RATING;
  return { fen, eloSelf: rating, eloOppo: input.maia?.opponentRating ?? rating };
}

/** Resolves after `ms`, or rejects as soon as `signal` aborts. */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("Maia's move was cancelled.");
}

/**
 * Maia's move in an engine game: one evaluation (ahead of any review's), a move drawn from its
 * policy as CSSLab draws it, then — in a timed game — the rest of a human-like thinking time
 * (think-time.ts; the evaluation's own time counts towards it). Rejects when `signal` aborts
 * (the move is no longer wanted) or Maia can't run.
 */
export async function playMaiaMove(
  evaluator: Maia3Evaluator,
  input: GameMoveInput,
  options: { signal: AbortSignal; random: () => number; now?: () => number }
): Promise<string> {
  const { signal, random, now = Date.now } = options;
  const query = maiaGameQuery(input);
  const started = now();
  const outputs = await evaluator.evaluate([query], { priority: "game", signal });
  const output = outputs.at(0);
  const move = output && sampleMaia3Move(output.policy, random);
  if (!output || !move) throw new Error("Maia has no move in this position.");
  const { clock } = input;
  const white = input.side === "white";
  const fullMove = Number(query.fen.split(" ")[5]);
  const thinkMs = maiaThinkMs({
    remainingMs: clock ? (white ? clock.wtime : clock.btime) : null,
    incrementMs: clock ? (white ? clock.winc : clock.binc) : 0,
    moveNumber: Number.isFinite(fullMove) ? fullMove : 1,
    topProb: Math.max(0, ...Object.values(output.policy)),
    random
  });
  await wait(thinkMs - (now() - started), signal);
  return move;
}
