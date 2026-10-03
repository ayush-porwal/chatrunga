/**
 * Streaming PGN game splitter: text arrives in chunks of any size (a file read piece by piece)
 * and every complete game is handed on as soon as it ends. It wraps chessops' own streaming
 * parser, so the games are exactly the ones `parsePgn` would give for the whole text: a tag line
 * inside a comment, escaped quotes in tag values and games split across chunks all behave alike.
 */
import { emptyHeaders, PgnParser } from "chessops/pgn";
import type { Game, PgnNodeData } from "chessops/pgn";

export type PgnGameSplitter = {
  /** Parses the next piece of text; throws the first error `onGame` threw (later text is ignored). */
  write(chunk: string): void;
  /** Ends the input: the last game (without a trailing blank line) is handed on too. */
  end(): void;
};

/** A splitter calling `onGame` for every game, in input order (empty games included). */
export function createPgnGameSplitter(onGame: (game: Game<PgnNodeData>) => void): PgnGameSplitter {
  let failure: { error: unknown } | null = null;
  // No parser budget (NaN, as `parsePgn` uses): the caller bounds the input and its games.
  const parser = new PgnParser(
    (game, error) => {
      if (failure) return;
      if (error) {
        failure = { error };
        return;
      }
      try {
        onGame(game);
      } catch (thrown) {
        failure = { error: thrown };
      }
    },
    emptyHeaders,
    NaN
  );
  const check = () => {
    if (failure) throw failure.error;
  };
  // The parser only drops a line's `\r` when the `\n` arrives in the same piece, so a piece ending
  // in `\r` keeps it back for the next one (a CRLF split across pieces would leave it in comments).
  let carry = "";
  return {
    write(chunk) {
      check();
      let text = carry + chunk;
      carry = "";
      if (text.endsWith("\r")) {
        carry = "\r";
        text = text.slice(0, -1);
      }
      parser.parse(text, { stream: true });
      check();
    },
    end() {
      check();
      parser.parse(carry);
      carry = "";
      check();
    }
  };
}
