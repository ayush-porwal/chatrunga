import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { REPERTOIRE_POSITION_KEY_VERSION, type RepertoireColor } from "../types/repertoire";

const KEY_PREFIX = `v${REPERTOIRE_POSITION_KEY_VERSION}:`;

/**
 * Versioned opening-decision identity of a position (design §7.2): piece placement, side to move,
 * castling rights in `KQkq` order (kept even when castling is obstructed), and the en-passant
 * square only when an en-passant capture is actually legal (pins and king safety included).
 * Move counters are left out, so the same position reached at a different move number matches.
 *
 * Throws on an invalid FEN or an illegal standard-chess position.
 */
export function positionKey(fen: string): string {
  const setup = parseFen(fen.trim()).unwrap(
    (value) => value,
    (error) => {
      throw new Error(`Invalid FEN for position key: ${error.message} (${fen})`);
    }
  );
  const position = Chess.fromSetup(setup).unwrap(
    (value) => value,
    (error) => {
      throw new Error(`Illegal position for position key: ${error.message} (${fen})`);
    }
  );
  // `toSetup` keeps only castling rights backed by a king and rook on their squares, and only an
  // en-passant square the side to move can legally capture on; `epd` drops the move counters.
  return `${KEY_PREFIX}${makeFen(position.toSetup(), { epd: true })}`;
}

/** The side to move in `fen` (the player whose decision the position is). */
export function playerToMove(fen: string): RepertoireColor {
  const setup = parseFen(fen.trim()).unwrap(
    (value) => value,
    (error) => {
      throw new Error(`Invalid FEN: ${error.message} (${fen})`);
    }
  );
  return setup.turn;
}
