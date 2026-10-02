import { applySan, applyUserMove } from "@chaturanga/shared/chess/position";
import { standardCastlingUci } from "@chaturanga/shared/chess/review";
import type { UserMove } from "@chaturanga/shared/types/chess";
import { userMoveBetween, userMoveFromUci } from "@/lib/uci";

/** A legal move resolved against a position: standard UCI (castling as `e1g1`), SAN and the FEN after. */
export type ResolvedMove = { uci: string; san: string; fenAfter: string };

export type TypedMoveResult = { ok: true; move: ResolvedMove } | { ok: false; error: string };

const SQUARE_TO_SQUARE = /^([a-h][1-8])[-x]?([a-h][1-8])=?([qrbn])?$/;
const CASTLING = /^[0o]-[0o](-[0o])?([+#])?$/;
const TRAILING_ANNOTATION = /[!?]+$/;

/**
 * The legal move between two squares in `fen` (a board drag or click), or null when it isn't legal
 * or the position can't be read. Castling comes back in standard king-destination UCI even when the
 * king was dropped on its rook.
 */
export function resolveBoardMove(
  fen: string,
  from: string,
  to: string,
  promotion?: UserMove["promotion"]
): ResolvedMove | null {
  const move = userMoveBetween(from, to, promotion);
  if (!move) return null;
  return resolved(fen, () => applyUserMove(fen, move));
}

/**
 * Reads a typed move: SAN (`Nf3`, `exd5`, `O-O`, `0-0`, `e8=Q`, also `nf3`) or square to square
 * (`e2e4`, `e2-e4`, `e7e8q`). Returns the resolved move, or an error message to show beside the
 * field when the text is empty, unreadable or not a legal move in `fen`.
 */
export function parseTypedMove(fen: string, text: string): TypedMoveResult {
  const cleaned = text.trim().replace(TRAILING_ANNOTATION, "");
  if (!cleaned) return { ok: false, error: "Type a move, like Nf3 or e2e4." };
  for (const candidate of typedMoveCandidates(cleaned)) {
    const move =
      candidate.kind === "uci" ? resolveUci(fen, candidate.text) : resolveSan(fen, candidate.text);
    if (move) return { ok: true, move };
  }
  return { ok: false, error: `${text.trim()} isn't legal here.` };
}

type Candidate = { kind: "uci" | "san"; text: string };

/** The readings worth trying for typed text, most literal first. */
function typedMoveCandidates(text: string): Candidate[] {
  const lower = text.toLowerCase();
  const squares = SQUARE_TO_SQUARE.exec(lower);
  if (squares) return [{ kind: "uci", text: `${squares[1]}${squares[2]}${squares[3] ?? ""}` }];
  if (CASTLING.test(lower)) {
    return [{ kind: "san", text: `${lower.split("-").length === 3 ? "O-O-O" : "O-O"}` }];
  }
  const candidates: Candidate[] = [{ kind: "san", text }];
  // A lowercase piece letter (`nf3`); not `b`, which is also a pawn file (`bxc3`).
  if (/^[nrqk]/.test(text))
    candidates.push({ kind: "san", text: text[0].toUpperCase() + text.slice(1) });
  return candidates;
}

function resolveUci(fen: string, uci: string): ResolvedMove | null {
  const move = userMoveFromUci(uci);
  return move ? resolved(fen, () => applyUserMove(fen, move)) : null;
}

function resolveSan(fen: string, san: string): ResolvedMove | null {
  return resolved(fen, () => applySan(fen, san));
}

/** Runs a chessops move application, tolerating an unreadable FEN, and normalises castling UCI. */
function resolved(
  fen: string,
  apply: () => { fen: string; san: string; uci: string } | null
): ResolvedMove | null {
  try {
    const result = apply();
    if (!result) return null;
    return { uci: standardCastlingUci(fen, result.uci), san: result.san, fenAfter: result.fen };
  } catch {
    return null;
  }
}

/** The parts of a key press that decide whether it opens the typed-move entry. */
export type TypedMoveTriggerKey = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "altKey" | "repeat"
>;

/**
 * Keys that open the entry with themselves as its first character: files, piece letters and the
 * castling letters. Lowercase `f` is left out because it is the app-wide Focus board shortcut
 * (type `/` first for an f-file move); `x` and the other shortcut keys aren't move starts anyway.
 */
const SEED_KEY = /^[a-egh]$|^[NBRQKO0]$/;

/**
 * What a key press does to a closed typed-move entry: null when it shouldn't open it, otherwise the
 * text to seed it with (`""` for `/`, the character itself for a move start such as `N` or `e`).
 * Never opens while a text field has focus (`typing`), while something else owns the keyboard
 * (`blocked`: a dialog or the promotion picker, or the side to move can't move), when focus is
 * elsewhere in the app (`inScope` is false), with meta / ctrl / alt held, or on key repeat.
 */
export function typedMoveTrigger(
  event: TypedMoveTriggerKey,
  { typing, blocked, inScope }: { typing: boolean; blocked: boolean; inScope: boolean }
): string | null {
  if (typing || blocked || !inScope) return null;
  if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return null;
  if (event.key === "/") return "";
  return SEED_KEY.test(event.key) ? event.key : null;
}
