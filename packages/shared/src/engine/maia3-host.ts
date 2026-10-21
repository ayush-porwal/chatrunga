/**
 * Maia 3's host window as main reads it: the messages crossing the process boundary (checked
 * field by field), each output checked against its position, and a game move drawn from a policy.
 * Only main's Maia code (loaded when Maia is first used) and the host itself need these.
 */
import { parseUci } from "chessops/util";
import { positionFromFen } from "../chess/position";
import { isOneOf, isRecord } from "../types/guards";
import { rankedMoves, type Maia3Output } from "./maia3";

/** A policy whose probabilities sum this far from 1 is not a distribution over the moves. */
const POLICY_SUM_TOLERANCE = 0.01;

/** A request to the host window: `batchEvaluateMaia3(boards, eloSelfs, eloOppos)`. */
export type MaiaHostRequest = {
  type: "evaluate";
  id: number;
  boards: string[];
  eloSelfs: number[];
  eloOppos: number[];
};

const MAIA_HOST_STATUSES = ["loading", "no-cache", "downloading", "ready", "error"] as const;
type MaiaHostStatus = (typeof MAIA_HOST_STATUSES)[number];

/** What the host window sends back: its model's status, or the answer to a request. */
export type MaiaHostMessage =
  | { type: "status"; status: MaiaHostStatus; progress?: number; error?: string }
  | { type: "result"; id: number; result: Maia3Output[] }
  | { type: "error"; id: number; message: string };

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isRequestId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** A Maia 3 output's shape (numbers, not yet their ranges or the moves' legality). */
function outputShape(value: unknown): Maia3Output | null {
  if (!isRecord(value) || !isFiniteNumber(value.value) || !isRecord(value.policy)) return null;
  const policy: Record<string, number> = {};
  for (const [uci, prob] of Object.entries(value.policy)) {
    if (!isFiniteNumber(prob)) return null;
    policy[uci] = prob;
  }
  return { policy, value: value.value };
}

function statusMessage(raw: Record<string, unknown>): MaiaHostMessage | null {
  const { status, progress, error } = raw;
  if (!isOneOf(MAIA_HOST_STATUSES, status)) return null;
  if (progress !== undefined && !isFiniteNumber(progress)) return null;
  if (error !== undefined && typeof error !== "string") return null;
  return {
    type: "status",
    status,
    ...(progress === undefined ? {} : { progress }),
    ...(error === undefined ? {} : { error })
  };
}

function resultMessage(raw: Record<string, unknown>): MaiaHostMessage | null {
  if (!isRequestId(raw.id) || !Array.isArray(raw.result)) return null;
  const result: Maia3Output[] = [];
  const items: readonly unknown[] = raw.result;
  for (const item of items) {
    const output = outputShape(item);
    if (!output) return null;
    result.push(output);
  }
  return { type: "result", id: raw.id, result };
}

/**
 * A message from the host window, checked field by field (it crosses a process boundary); null
 * for anything else. Outputs are checked for shape only: {@link validMaia3Output} checks them
 * against their position.
 */
export function parseMaiaHostMessage(raw: unknown): MaiaHostMessage | null {
  if (!isRecord(raw)) return null;
  switch (raw.type) {
    case "status":
      return statusMessage(raw);
    case "result":
      return resultMessage(raw);
    case "error":
      return isRequestId(raw.id) && typeof raw.message === "string"
        ? { type: "error", id: raw.id, message: raw.message }
        : null;
    default:
      return null;
  }
}

const isProbability = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;

/**
 * `output` when it fits `fen`: every policy move is legal there, every probability and the value
 * are in [0, 1], and the probabilities sum to 1 (an empty policy only for a position without legal
 * moves). Returned with its policy sorted descending; null for an unreadable FEN or a bad output.
 */
export function validMaia3Output(fen: string, output: Maia3Output): Maia3Output | null {
  if (!isProbability(output.value)) return null;
  let pos: ReturnType<typeof positionFromFen>;
  try {
    pos = positionFromFen(fen);
  } catch {
    return null;
  }
  const moves = rankedMoves(output.policy);
  let sum = 0;
  for (const { uci, prob } of moves) {
    const move = parseUci(uci);
    if (!isProbability(prob) || !move || !pos.isLegal(move)) return null;
    sum += prob;
  }
  const hasMoves = [...pos.allDests()].some(([, dests]) => dests.nonEmpty());
  if (hasMoves ? Math.abs(sum - 1) > POLICY_SUM_TOLERANCE : moves.length > 0) return null;
  return {
    policy: Object.fromEntries(moves.map(({ uci, prob }) => [uci, prob])),
    value: output.value
  };
}

/**
 * A move drawn from Maia 3's policy as CSSLab's `sample_from_logits` draws it by default
 * (temperature 1, top-p 1): each move with its own probability. The policy is already the softmax
 * over the legal moves' logits, so drawing in proportion to it is the same draw. Null when no
 * move has a positive probability. `random` returns [0, 1) (Math.random by default).
 */
export function sampleMaia3Move(
  policy: Readonly<Record<string, number>>,
  random: () => number = Math.random
): string | null {
  const moves = Object.entries(policy).filter(([, prob]) => Number.isFinite(prob) && prob > 0);
  const total = moves.reduce((sum, [, prob]) => sum + prob, 0);
  if (!moves.length || !(total > 0)) return null;
  let target = random() * total;
  for (const [uci, prob] of moves) {
    if (target < prob) return uci;
    target -= prob;
  }
  // Rounding left the draw just past the last move's share.
  return moves.at(-1)?.[0] ?? null;
}
