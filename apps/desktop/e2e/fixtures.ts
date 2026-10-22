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
const ENDGAME_FEN = "8/8/8/4k3/8/8/4P3/4K3 w - - 0 1";
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

/**
 * A two-page PDF titled `title` (its Info dictionary), each page a few filled rectangles (no
 * fonts): enough for PDF.js to open, count and render it, and nothing a model could read.
 */
export function writeBookPdf(dir: string, title: string): string {
  const content = (shade: number) =>
    `${shade} g 40 300 220 30 re f 40 240 160 20 re f 40 200 190 20 re f`;
  const streams = [content(0), content(0.3)];
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 5 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 6 0 R >>",
    ...streams.map((stream) => `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`),
    `<< /Title (${title}) >>`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\n`;
  pdf += `startxref\n${xref}\n%%EOF\n`;
  const file = join(dir, "e2e-book.pdf");
  writeFileSync(file, pdf, "latin1");
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

/** The Lichess broadcast the broadcast journeys watch (ids are Lichess's 8-character ones). */
const BROADCAST = { tourId: "GrSw2026", roundId: "Round007" } as const;

const BROADCAST_GAMES = [
  {
    id: "Game0001",
    white: { name: "Gukesh D", title: "GM", rating: 2787, fed: "IND" },
    black: { name: "Carlsen, Magnus", title: "GM", rating: 2837, fed: "NOR" },
    sans: "e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 Re1 Nd6 Nxe5 Be7 Bf1 Nxe5 Rxe5 O-O d4 Bf6 Re1 Re8 c3 Rxe1 Qxe1 Ne8 Bf4 d6 Nd2 Bf5 Qe2 c6 Re1 Qd7 h3 Nc7",
    fen: "r5k1/ppnq1ppp/2pp1b2/5b2/3P1B2/2P4P/PP1NQPP1/4RBK1 w - - 1 18",
    lastMove: "e8c7",
    result: "*"
  },
  {
    id: "Game0002",
    white: { name: "Caruana, Fabiano", title: "GM", rating: 2795, fed: "USA" },
    black: { name: "Nakamura, Hikaru", title: "GM", rating: 2804, fed: "USA" },
    sans: "d4 Nf6 c4 e6 Nf3 d5 Nc3 Be7 Bf4 O-O e3 c5 dxc5 Bxc5 Qc2 Nc6 a3 Qa5 Rd1 Re8 Nd2 e5 Bg5 Nd4 Qb1 Bf5 Bd3 Bxd3 Qxd3",
    fen: "r3r1k1/pp3ppp/5n2/q1bpp1B1/2Pn4/P1NQP3/1P1N1PPP/3RK2R b K - 0 15",
    lastMove: "b1d3",
    result: "*"
  },
  {
    id: "Game0003",
    white: { name: "Ding Liren", title: "GM", rating: 2734, fed: "CHN" },
    black: { name: "Duda, Jan-Krzysztof", title: "GM", rating: 2729, fed: "POL" },
    sans: "Nf3 d5 g3 Nf6 Bg2 c6 O-O Bg4 d3 Nbd7 Nbd2 e5 e4 dxe4 dxe4 Bc5 h3 Bh5 Qe1 O-O Nh4 Re8 Nf5 Bf8 g4 Bg6",
    fen: "r2qrbk1/pp1n1ppp/2p2nb1/4pN2/4P1P1/7P/PPPN1PB1/R1B1QRK1 w - - 1 14",
    lastMove: "h5g6",
    result: "1/2-1/2"
  }
] as const;

/** `sans` as PGN movetext, each move with a falling `[%clk]`. */
function movetext(sans: string, result: string): string {
  const parts = sans.split(" ").map((san, index) => {
    const seconds = 6000 - index * 50;
    const clock = `${Math.floor(seconds / 3600)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    const number = index % 2 === 0 ? `${index / 2 + 1}. ` : "";
    return `${number}${san} { [%clk ${clock}] }`;
  });
  return `${parts.join(" ")} ${result}`;
}

type BroadcastSide = { name: string; title: string; rating: number; fed: string };

/** The round's games as its PGN stream sends them. */
function roundStream(
  games: readonly {
    id: string;
    white: BroadcastSide;
    black: BroadcastSide;
    sans: string;
    result: string;
  }[]
): string {
  const { roundId } = BROADCAST;
  return games
    .map(
      (game) => `[Event "FIDE Grand Swiss 2026"]
[Round "7.${game.id.slice(-1)}"]
[White "${game.white.name}"]
[Black "${game.black.name}"]
[WhiteElo "${game.white.rating}"]
[BlackElo "${game.black.rating}"]
[WhiteTitle "${game.white.title}"]
[BlackTitle "${game.black.title}"]
[Result "${game.result}"]
[GameURL "https://lichess.org/broadcast/fide-grand-swiss-2026/round-7/${roundId}/${game.id}"]

${movetext(game.sans, game.result)}

`
    )
    .join("\n");
}

/** The round's stream in the folder writeBroadcastFixtures wrote. */
const ROUND_STREAM_FILE = "round.pgn";

/**
 * Board 1 played on in the round's stream (`dir`, as writeBroadcastFixtures wrote it): 18. Nf3,
 * and Black resigns. The stream sends it from its next connection.
 */
export function endBroadcastGame(dir: string): void {
  writeFileSync(
    join(dir, ROUND_STREAM_FILE),
    roundStream(
      BROADCAST_GAMES.map((game) =>
        game.id === "Game0001" ? { ...game, sans: `${game.sans} Nf3`, result: "1-0" } : game
      )
    )
  );
}

/**
 * The broadcast's Lichess answers as files, by URL (served by `routeToFile`): the top list, the
 * tournament, its round's boards and standings, and the round's PGN stream (three games).
 */
export function writeBroadcastFixtures(dir: string): Record<string, string> {
  const { tourId, roundId } = BROADCAST;
  const tour = {
    id: tourId,
    name: "FIDE Grand Swiss 2026",
    slug: "fide-grand-swiss-2026",
    createdAt: 1,
    url: `https://lichess.org/broadcast/fide-grand-swiss-2026/${tourId}`,
    tier: 5,
    dates: [Date.now() - 6 * 86_400_000, Date.now() + 5 * 86_400_000],
    info: { location: "Samarkand, Uzbekistan", tc: "100+30", fideTC: "standard" },
    description: "The open Swiss that qualifies two players for the Candidates."
  };
  const round = {
    id: roundId,
    name: "Round 7",
    slug: "round-7",
    ongoing: true,
    startsAt: Date.now() - 2 * 3_600_000,
    url: `https://lichess.org/broadcast/fide-grand-swiss-2026/round-7/${roundId}`
  };
  const player = (
    side: { name: string; title: string; rating: number; fed: string },
    clock: number
  ) => ({
    ...side,
    clock
  });
  const games = BROADCAST_GAMES.map((game) => ({
    id: game.id,
    name: `${game.white.name} - ${game.black.name}`,
    fen: game.fen,
    players: [player(game.white, 360_000), player(game.black, 340_000)],
    lastMove: game.lastMove,
    thinkTime: 30,
    status: game.result === "1/2-1/2" ? "½-½" : game.result
  }));
  const answers: Record<string, unknown> = {
    "https://lichess.org/api/broadcast/top?page=1": {
      active: [{ tour, round }],
      upcoming: [],
      past: { currentPage: 1, maxPerPage: 24, currentPageResults: [], nextPage: null }
    },
    [`https://lichess.org/api/broadcast/${tourId}`]: {
      tour,
      rounds: [
        {
          ...round,
          id: "Round006",
          name: "Round 6",
          slug: "round-6",
          ongoing: false,
          finished: true
        },
        round
      ],
      defaultRoundId: roundId
    },
    [`https://lichess.org/api/broadcast/-/-/${roundId}`]: { tour, round, games },
    // Lichess's search matches event names only: players are found in the rounds read.
    "https://lichess.org/api/broadcast/search?q=gukesh": { currentPageResults: [] },
    [`https://lichess.org/broadcast/${tourId}/players`]: [
      { name: "Gukesh D", title: "GM", rating: 2787, fed: "IND", score: 5.5, played: 6, rank: 1 },
      {
        name: "Carlsen, Magnus",
        title: "GM",
        rating: 2837,
        fed: "NOR",
        score: 5,
        played: 6,
        rank: 2
      }
    ]
  };
  const files: Record<string, string> = {};
  for (const [url, body] of Object.entries(answers)) {
    const file = join(dir, `${Object.keys(files).length}.json`);
    writeFileSync(file, JSON.stringify(body));
    files[url] = file;
  }
  const stream = join(dir, ROUND_STREAM_FILE);
  writeFileSync(stream, roundStream(BROADCAST_GAMES));
  files[
    `https://lichess.org/api/stream/broadcast/round/${roundId}.pgn?clocks=true&comments=false`
  ] = stream;
  return files;
}
