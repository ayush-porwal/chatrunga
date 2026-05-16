import { Chess } from "chessops/chess";
import { chessgroundDests } from "chessops/compat";
import { makeFen, parseFen } from "chessops/fen";
import { makeSanAndPlay, parseSan } from "chessops/san";
import { makeUci, parseSquare, parseUci } from "chessops/util";
import type { Move, SquareName } from "chessops/types";
import type { Color, UserMove } from "../types/chess";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export function positionFromFen(fen: string) {
  const setup = parseFen(fen).unwrap();
  return Chess.fromSetup(setup).unwrap();
}

export function fenAfterUci(fen: string, uci: string): string | null {
  const pos = positionFromFen(fen);
  const move = parseUci(uci);
  if (!move || !pos.isLegal(move)) return null;
  pos.play(move);
  return makeFen(pos.toSetup());
}

export function applyUserMove(fen: string, input: UserMove): { fen: string; san: string; uci: string } | null {
  const pos = positionFromFen(fen);
  const uci = `${input.from}${input.to}${promotionSuffix(input.promotion)}`;
  const move = parseUci(uci);
  if (!move || !pos.isLegal(move)) return null;
  const san = makeSanAndPlay(pos, move);
  return { fen: makeFen(pos.toSetup()), san, uci: makeUci(move) };
}

export function applySan(fen: string, san: string): { fen: string; san: string; uci: string } | null {
  const pos = positionFromFen(fen);
  const move = parseSan(pos, san);
  if (!move || !pos.isLegal(move)) return null;
  const normalizedSan = makeSanAndPlay(pos, move);
  return { fen: makeFen(pos.toSetup()), san: normalizedSan, uci: makeUci(move) };
}

export function legalDestsForFen(fen: string): Map<SquareName, SquareName[]> {
  return chessgroundDests(positionFromFen(fen));
}

export function isPromotionMove(fen: string, from: string, to: string): boolean {
  const pos = positionFromFen(fen);
  const fromSquare = parseSquare(from);
  const toSquare = parseSquare(to);
  if (fromSquare === undefined || toSquare === undefined) return false;
  const piece = pos.board.get(fromSquare);
  if (!piece || piece.role !== "pawn") return false;
  const promotionRank = piece.color === "white" ? "8" : "1";
  return to.endsWith(promotionRank);
}

export function statusForFen(fen: string): {
  turn: Color;
  isCheck: boolean;
  isCheckmate: boolean;
  isStalemate: boolean;
  isEnd: boolean;
  result: string;
} {
  const pos = positionFromFen(fen);
  const outcome = pos.outcome();
  let result = "*";
  if (outcome?.winner === "white") result = "1-0";
  if (outcome?.winner === "black") result = "0-1";
  if (outcome && !outcome.winner) result = "1/2-1/2";

  return {
    turn: pos.turn,
    isCheck: pos.isCheck(),
    isCheckmate: pos.isCheckmate(),
    isStalemate: pos.isStalemate(),
    isEnd: pos.isEnd(),
    result
  };
}

export function moveFromUci(uci: string): Move | undefined {
  return parseUci(uci);
}

function promotionSuffix(promotion: UserMove["promotion"]): string {
  switch (promotion) {
    case "queen":
      return "q";
    case "rook":
      return "r";
    case "bishop":
      return "b";
    case "knight":
      return "n";
    default:
      return "";
  }
}
