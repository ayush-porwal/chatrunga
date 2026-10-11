/**
 * The field checks every IPC parser is built from. Each returns the value in its checked type or
 * throws `Invalid <label>: <reason>`; the renderer is untrusted, so nothing is passed through.
 */
import { isAbsolute } from "node:path";
import { positionFromFen } from "@chaturanga/shared/chess/position";
import { isRecord } from "@chaturanga/shared/types/guards";

export const MAX_ID = 200;
export const MAX_PATH = 4096;
export const MAX_NAME = 200;
/** PGN tag values (a long Event or Opening name) — generous, but bounded. */
export const MAX_HEADER = 2_000;
export const MAX_MOVES = 2000;
export const MAX_PGN_BYTES = 20 * 1024 * 1024;
/** UCI long algebraic move (castling may be king-takes-rook in Chess960 form). */
export const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
// oxlint-disable-next-line no-control-regex -- it matches the control characters an input may not contain
export const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export type Fields = Record<string, unknown>;

export function fail(label: string, reason: string): never {
  throw new Error(`Invalid ${label}: ${reason}`);
}

export function asObject(value: unknown, label: string): Fields {
  if (!isRecord(value)) fail(label, "expected an object");
  return value;
}

export function asString(value: unknown, label: string, maxLength: number = MAX_PATH): string {
  if (typeof value !== "string") fail(label, "expected a string");
  if (value.length > maxLength) fail(label, "too long");
  return value;
}

/** A single-line, non-empty identifier (database row ids, engine ids, source ids). */
export function asId(value: unknown, label = "id"): string {
  const id = asString(value, label, MAX_ID).trim();
  if (!id || CONTROL_CHARS.test(id)) fail(label, "expected a non-empty identifier");
  return id;
}

export function optional<T>(value: unknown, parse: (value: unknown) => T): T | undefined {
  return value === undefined ? undefined : parse(value);
}

export function nullable<T>(value: unknown, parse: (value: unknown) => T): T | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return parse(value);
}

export function asBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail(label, "expected a boolean");
  return value;
}

export function asFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(label, "expected a number");
  return value;
}

export function asWholeNumber(value: unknown, label: string): number {
  const number = asFiniteNumber(value, label);
  if (!Number.isInteger(number) || number < 0) fail(label, "must be a whole number");
  return number;
}

export function asStringArray(
  value: unknown,
  label: string,
  maxItems: number,
  maxLength = MAX_NAME
): string[] {
  if (!Array.isArray(value)) fail(label, "expected an array");
  if (value.length > maxItems) fail(label, "too many items");
  return value.map((item, index) => asString(item, `${label}[${index}]`, maxLength));
}

/** Absolute path to a file the main process will spawn or read. */
export function asAbsolutePath(value: unknown, label: string): string {
  const path = asString(value, label).trim();
  if (!path || path.includes("\0")) fail(label, "expected a file path");
  if (!isAbsolute(path)) fail(label, "must be an absolute path");
  return path;
}

/** A FEN the chess library accepts — engines may crash on malformed positions. */
export function asFen(value: unknown, label = "FEN"): string {
  const fen = asString(value, label, 128).trim();
  if (CONTROL_CHARS.test(fen)) fail(label, "contains control characters");
  try {
    positionFromFen(fen);
  } catch {
    fail(label, "not a legal position");
  }
  return fen;
}

export function asUciMoves(value: unknown, label = "moves"): string[] {
  const moves = asStringArray(value, label, MAX_MOVES, 5);
  for (const move of moves) if (!UCI_MOVE.test(move)) fail(label, `"${move}" is not a UCI move`);
  return moves;
}

export function asNumberInRange(value: unknown, label: string, min: number, max: number): number {
  const number = asFiniteNumber(value, label);
  if (number < min || number > max) fail(label, `must be between ${min} and ${max}`);
  return number;
}

export function asIntegerInRange(value: unknown, label: string, min: number, max: number): number {
  const number = asNumberInRange(value, label, min, max);
  if (!Number.isInteger(number)) fail(label, "expected a whole number");
  return number;
}
