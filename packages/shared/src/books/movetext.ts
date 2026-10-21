/**
 * Movetext as chess books (and models reading them) write it: "15 Rd2 Rc5", "15...Rfd8",
 * "15 ... Rfd8", castling as 0-0, figurines, annotation symbols glued to the move, results.
 */

export type MoveToken = {
  /** The move number, as printed or counted on from the last one printed (0 before any). */
  number: number;
  /** Black's move. */
  black: boolean;
  /** Whether a move number was printed right before it. */
  numbered: boolean;
  /** SAN as chessops reads it (castling with letters O, no annotation symbols). */
  san: string;
  /** Annotation symbols printed with the move ("!?", "±"), or null. */
  symbols: string | null;
  raw: string;
};

const FIGURINES: Record<string, string> = {
  "♔": "K",
  "♚": "K",
  "♕": "Q",
  "♛": "Q",
  "♖": "R",
  "♜": "R",
  "♗": "B",
  "♝": "B",
  "♘": "N",
  "♞": "N"
};

const RESULT = /^(?:1-0|0-1|1\/2-1\/2|½-½|\*)$/;
/** A move number with its dots ("15", "15.", "15...", "15…"), maybe with the move glued on. */
const MOVE_NUMBER = /^(\d+)(\.\.\.|\.)?(.*)$/;
const CASTLING = /^([0O])-\1(-\1)?/;
const PIECE_MOVE = /^[KQRBN][a-h]?[1-8]?x?[a-h][1-8]/;
const PAWN_MOVE = /^[a-h](?:x[a-h])?[1-8](?:=?[QRBN])?/;
/** Characters that only ever annotate (never part of a move). */
const SYMBOL_ONLY = /^[!?±∓⩲⩱∞=+\-/#]+$/;

/** Figurines as letters, typographic dashes and ellipses as plain ones, captures as `x`. */
function normalize(text: string): string {
  return text
    .replace(/[♔♚♕♛♖♜♗♝♘♞]/g, (figurine) => FIGURINES[figurine] ?? figurine)
    .replace(/[–—‐]/g, "-")
    .replace(/…/g, "...")
    .replace(/×/g, "x")
    .replace(/[{][^}]*[}]/g, " ")
    .replace(/[()[\]]/g, " ");
}

/** A move token split into its SAN and the symbols after it. */
function splitMove(raw: string): { san: string; symbols: string | null } {
  const castling = CASTLING.exec(raw);
  let core: string;
  if (castling) core = castling[2] ? "O-O-O" : "O-O";
  else core = (PIECE_MOVE.exec(raw) ?? PAWN_MOVE.exec(raw))?.[0] ?? "";
  // An unreadable move (OCR noise) keeps everything up to the first symbol, to be reported.
  if (!core) core = /^[^!?±∓⩲⩱∞=+#$]*/.exec(raw)?.[0] ?? raw;
  let rest = raw.slice(castling ? castling[0].length : core.length);
  let check = /^[+#]/.exec(rest)?.[0] ?? "";
  // "+-" after a move is White's winning evaluation, not a check.
  if (check === "+" && rest.startsWith("+-")) check = "";
  rest = rest.slice(check.length);
  return { san: `${core}${check}`, symbols: rest || null };
}

/**
 * The moves of `movetext`, numbered as printed: a number with "..." starts Black's move, other
 * numbers White's; unnumbered moves alternate. Results and stray symbols are dropped (a symbol
 * standing alone joins the move before it).
 */
export function tokenizeMovetext(movetext: string): MoveToken[] {
  const tokens: MoveToken[] = [];
  let number = 0;
  let black = false;
  let numbered = false;
  for (const word of normalize(movetext).split(/\s+/)) {
    let raw = word;
    if (!raw || RESULT.test(raw)) continue;
    const counted = CASTLING.test(raw) ? null : MOVE_NUMBER.exec(raw);
    if (counted) {
      number = Number(counted[1]);
      black = counted[2] === "...";
      numbered = true;
      raw = counted[3];
      if (!raw) continue;
    }
    if (raw === "...") {
      black = true;
      continue;
    }
    const previous = tokens.at(-1);
    if (SYMBOL_ONLY.test(raw) || /^\$\d+$/.test(raw)) {
      if (previous) previous.symbols = `${previous.symbols ?? ""}${raw}`;
      continue;
    }
    if (RESULT.test(raw)) continue;
    tokens.push({ number, black, numbered, ...splitMove(raw), raw: word });
    numbered = false;
    if (black) number += 1;
    black = !black;
  }
  return tokens;
}

/** Annotation symbols and their NAGs, longest spelling first so "!?" wins over "!". */
const SYMBOL_NAGS: readonly [string, string][] = [
  ["+/-", "$16"],
  ["-/+", "$17"],
  ["+/=", "$14"],
  ["=/+", "$15"],
  ["!!", "$3"],
  ["??", "$4"],
  ["!?", "$5"],
  ["?!", "$6"],
  ["+-", "$18"],
  ["-+", "$19"],
  ["+=", "$14"],
  ["=+", "$15"],
  ["!", "$1"],
  ["?", "$2"],
  ["=", "$10"],
  ["∞", "$13"],
  ["⩲", "$14"],
  ["⩱", "$15"],
  ["±", "$16"],
  ["∓", "$17"]
];

/** The NAGs of an annotation ("!? ±" → $5 $16); `$n` NAGs pass through, anything else is skipped. */
export function symbolsToNags(symbols: string | null | undefined): string[] {
  const nags: string[] = [];
  const add = (nag: string) => {
    if (!nags.includes(nag)) nags.push(nag);
  };
  let rest = (symbols ?? "").replace(/\s+/g, "");
  while (rest) {
    const nag = /^\$\d{1,3}/.exec(rest)?.[0];
    if (nag) {
      add(nag);
      rest = rest.slice(nag.length);
      continue;
    }
    const match = SYMBOL_NAGS.find(([symbol]) => rest.startsWith(symbol));
    if (match) add(match[1]);
    rest = rest.slice(match ? match[0].length : 1);
  }
  return nags;
}
