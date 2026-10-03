// Small, generated inputs for the smoke journeys (nothing large or binary is checked in).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";

export const RUY_LOPEZ_PGN = `[Event "E2E smoke"]
[White "Alpha"]
[Black "Beta"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *
`;

/** King and pawn against king, white to move: three pieces on the board. */
export const ENDGAME_FEN = "8/8/8/4k3/8/8/4P3/4K3 w - - 0 1";
export const ENDGAME_PGN = `[Event "E2E position"]
[SetUp "1"]
[FEN "${ENDGAME_FEN}"]
[Result "*"]

*
`;

export function writePgn(dir: string, name: string, pgn: string): string {
  const file = join(dir, name);
  writeFileSync(file, pgn);
  return file;
}

export const LICHESS_PUZZLES_URL = "https://database.lichess.org/lichess_db_puzzle.csv.zst";

/** How many matches the app's quick scan reads from a puzzle file's start (QUICK_MATCHES). */
export const QUICK_SCAN_MATCHES = 500;

/**
 * A Lichess-format puzzle file (`.csv.zst`, as the real download): one mate-in-one (after
 * 3...Nf6?? Qxf7#) under `count` rows. The first QUICK_SCAN_MATCHES rows, all a quick scan of the
 * file's start can reach, share one id, `qA0000`; the rest are `qB0500`…. So the first puzzle is
 * always `qA0000`, and once it is shown (and excluded) only a whole-file scan has another to give.
 */
export function writeLichessPuzzleFile(dir: string, count = 3000): string {
  const header =
    "PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags";
  const rows = Array.from({ length: count }, (_, index) => {
    const id = index < QUICK_SCAN_MATCHES ? "qA0000" : `qB${String(index).padStart(4, "0")}`;
    return `${id},r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3,g8f6 h5f7,1500,75,95,1000,mate mateIn1 oneMove opening,https://lichess.org/e2e00000#6,Italian_Game`;
  });
  const file = join(dir, "lichess_db_puzzle.csv.zst");
  writeFileSync(file, zstdCompressSync(Buffer.from([header, ...rows, ""].join("\n"))));
  return file;
}
