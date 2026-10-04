// Scripted UCI engine for EngineManager tests. argv[2] = a log file: one line per process start
// ("spawn"), per command received and per exit ("exit"), so tests can count spawns and check what was sent.
// `go infinite` streams info lines until `stop`; any other `go` answers after 30 ms.
// argv[3] = "slow-start": `uciok` only after 10 s (a large network loading); "slow-exit": quit and
// SIGTERM take 300 ms to end the process (a network being freed); "stubborn": both are ignored;
// "lines": `go infinite` streams three lines that fit the position (LINES below, by the moves after
// the start position), and none for a position it doesn't know.
// "review": a bounded `go` (a game review's search) answers with scripted MultiPV lines for the
// position set by `position fen` (REVIEW below: the Blackburne Shilling trap, 1. e4 e5 2. Nf3 Nc6
// 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3#), and `searchmoves` keeps only the
// lines of those moves. "review-unstable": the same with two changes for the verification tests
// (REVIEW_UNSTABLE): 4. Nxe5's loss lands near a severity boundary unless the played move is
// searched alone, and a deeper search of 4... Qg5 (a larger budget than the first `go`) disagrees.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const log = (line) => appendFileSync(process.argv[2], `${line}\n`);
const out = (line) => process.stdout.write(`${line}\n`);
let timer = null;
let depth = 0;
/** The moves of the last `position` command (after `moves`). */
let positionMoves = "";
/** "lines" mode: the three lines for each position, by its moves from the start position. */
const LINES = {
  "": ["e2e4 e7e5 g1f3", "d2d4 d7d5", "g1f3 g8f6"],
  e2e4: ["e7e5 g1f3", "c7c5 g1f3", "e7e6 d2d4"],
  "e2e4 e7e5": ["g1f3 b8c6", "f1c4 g8f6", "b1c3 g8f6"],
  "e2e4 e7e5 g1f3": ["b8c6 f1b5", "g8f6 f3e5", "d7d6 d2d4"],
  "e2e4 e7e5 g1f3 b8c6": ["f1b5 a7a6", "f1c4 f8c5", "d2d4 e5d4"],
  "e2e4 e7e5 g1f3 b8c6 f1c4": ["g8f6 d2d3", "f8c5 c2c3", "f8e7 d2d4"],
  "e2e4 e7e5 g1f3 b8c6 f1c4 g8f6": ["d2d3 f8c5", "f3g5 d7d5", "b1c3 f8c5"]
};
/** Scripted review lines by FEN (board, side, castling, en passant): `score … pv …` per MultiPV line. */
const REVIEW = {
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -": {
    lines: ["cp 30 pv e2e4 e7e5", "cp 25 pv d2d4 d7d5", "cp 20 pv g1f3 d7d5"]
  },
  "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -": {
    lines: ["cp -30 pv e7e5 g1f3", "cp -35 pv c7c5 g1f3", "cp -40 pv e7e6 d2d4"]
  },
  "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -": {
    lines: ["cp 35 pv g1f3 b8c6", "cp 30 pv f1c4 g8f6", "cp 25 pv b1c3 g8f6"]
  },
  "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq -": {
    lines: ["cp -35 pv b8c6 f1b5", "cp -40 pv g8f6 f3e5", "cp -45 pv d7d6 d2d4"]
  },
  "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq -": {
    lines: ["cp 40 pv f1b5 a7a6", "cp 30 pv f1c4 f8c5", "cp 30 pv d2d4 e5d4"]
  },
  "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq -": {
    lines: ["cp -20 pv g8f6 d2d3", "cp -30 pv f8c5 c2c3", "cp -120 pv c6d4 f3d4"]
  },
  "r1bqkbnr/pppp1ppp/8/4p3/2BnP3/5N2/PPPP1PPP/RNBQK2R w KQkq -": {
    lines: ["cp 120 pv f3d4 e5d4", "cp 100 pv c2c3 d4f3", "cp 80 pv e1g1 g8f6"]
  },
  "r1bqkbnr/pppp1ppp/8/4N3/2BnP3/8/PPPP1PPP/RNBQK2R b KQkq -": {
    lines: ["cp 250 pv d8g5 e5f7 g5g2", "cp 40 pv d8e7 e5f3", "cp 0 pv d4c2 e1f1"]
  },
  "r1b1kbnr/pppp1ppp/8/4N1q1/2BnP3/8/PPPP1PPP/RNBQK2R w KQkq -": {
    lines: ["cp -120 pv c4f7 e8e7", "cp -160 pv e5g4 d7d5", "cp -200 pv d2d4 g5g2"]
  },
  "r1b1kbnr/pppp1Npp/8/6q1/2BnP3/8/PPPP1PPP/RNBQK2R b KQkq -": {
    lines: ["cp 500 pv g5g2 h1f1 g2e4", "cp 430 pv d4c2 e1f1", "cp 300 pv g8f6 f7h8"]
  },
  "r1b1kbnr/pppp1Npp/8/8/2BnP3/8/PPPP1PqP/RNBQK2R w KQkq -": {
    lines: ["cp -500 pv h1f1 g2e4", "cp -550 pv d1f3 d4f3", "cp -900 pv f7h8 g2h1"]
  },
  "r1b1kbnr/pppp1Npp/8/8/2BnP3/8/PPPP1PqP/RNBQKR2 b Qkq -": {
    lines: ["mate 2 pv g2e4 c4e2 d4f3", "cp 400 pv d4f3 d1f3"]
  },
  "r1b1kbnr/pppp1Npp/8/8/2Bnq3/8/PPPP1P1P/RNBQKR2 w Qkq -": {
    lines: ["cp -800 pv d1e2 e4e2", "mate -1 pv c4e2 d4f3"]
  },
  "r1b1kbnr/pppp1Npp/8/8/3nq3/8/PPPPBP1P/RNBQKR2 b Qkq -": { lines: ["mate 1 pv d4f3"] }
};
/** "review-unstable": what differs from REVIEW (`deeper`: a deeper search's lines; `only`: a lone move's). */
const REVIEW_UNSTABLE = {
  "r1bqkbnr/pppp1ppp/8/4N3/2BnP3/8/PPPP1PPP/RNBQK2R b KQkq -": {
    lines: ["cp 50 pv d8g5 e5f7 g5g2", "cp -100 pv d8e7 e5f3", "cp -150 pv d4c2 e1f1"],
    deeper: ["cp 60 pv d8e7 e5f3", "cp 40 pv d8g5 e5f7 g5g2"]
  },
  "r1bqkbnr/pppp1ppp/8/4p3/2BnP3/5N2/PPPP1PPP/RNBQK2R w KQkq -": {
    lines: ["cp 120 pv f3d4 e5d4", "cp 100 pv c2c3 d4f3", "cp 80 pv e1g1 g8f6"],
    only: { f3e5: "cp -30 pv f3e5 d8g5" }
  }
};
const mode = process.argv[3];
const review =
  mode === "review"
    ? REVIEW
    : mode === "review-unstable"
      ? { ...REVIEW, ...REVIEW_UNSTABLE }
      : null;
/** The FEN of the last `position fen` command. */
let positionFen = "";
/** The first bounded search's budget (`movetime` / `depth` / `nodes`): a larger one is "deeper". */
let baseBudget = null;

/** Answers a bounded `go` with the scripted lines of the current position. */
function answerReview(go) {
  const entry = review[positionFen.split(" ").slice(0, 4).join(" ")];
  const budget = Number(go.match(/\b(?:movetime|depth|nodes) (\d+)/)?.[1] ?? 0);
  baseBudget ??= budget;
  const only = go.match(/ searchmoves (.+)$/)?.[1].split(" ") ?? null;
  let lines = (budget > baseBudget && entry?.deeper) || entry?.lines || [];
  if (only) {
    lines = lines.filter((line) => only.includes(line.split(" pv ")[1]?.split(" ")[0]));
    if (!lines.length && entry?.only)
      lines = only.flatMap((move) => (entry.only[move] ? [entry.only[move]] : []));
  }
  lines.forEach((line, index) =>
    out(`info depth 12 seldepth 14 multipv ${index + 1} nodes 1000 score ${line}`)
  );
  const best = lines[0]?.split(" pv ")[1]?.split(" ")[0] ?? "0000";
  out(`bestmove ${best}`);
}
log("spawn");
log(`pid ${process.pid}`);
// "exit" is logged as the process goes (quit or kill), so tests can tell it has ended.
process.on("exit", () => log("exit"));
const quit = () => {
  if (mode === "slow-exit") setTimeout(() => process.exit(0), 300);
  else if (mode !== "stubborn") process.exit(0);
};
process.on("SIGTERM", quit);

createInterface({ input: process.stdin }).on("line", (raw) => {
  const line = raw.trim();
  log(line);
  if (line.startsWith("position ")) positionMoves = line.split(" moves ")[1] ?? "";
  if (line.startsWith("position fen "))
    positionFen = line.slice("position fen ".length).split(" moves ")[0];
  if (line === "uci") {
    out("id name Fake live");
    for (const name of ["Threads", "Hash", "MultiPV"])
      out(`option name ${name} type spin default 1 min 1 max 512`);
    if (mode === "slow-start") setTimeout(() => out("uciok"), 10_000);
    else out("uciok");
  } else if (line === "isready") out("readyok");
  else if (line === "go infinite") {
    depth = 0;
    const lines = mode === "lines" ? (LINES[positionMoves] ?? []) : null;
    timer = setInterval(() => {
      depth += 1;
      if (!lines)
        out(`info depth ${depth} multipv 1 score cp 20 nodes ${depth * 100} pv e2e4 e7e5`);
      else if (!lines.length) out(`info depth ${depth} multipv 1 score cp 0 nodes ${depth * 100}`);
      lines?.forEach((pv, index) =>
        out(
          `info depth ${depth} multipv ${index + 1} score cp ${30 - index * 25} nodes ${depth * 100} pv ${pv}`
        )
      );
    }, 5);
  } else if (line.startsWith("go") && review) {
    answerReview(line);
  } else if (line.startsWith("go")) {
    timer = setTimeout(() => {
      timer = null;
      out("info depth 5 multipv 1 score cp 30 pv g1f3");
      out("bestmove g1f3");
    }, 30);
  } else if (line === "stop") {
    if (timer) {
      clearInterval(timer);
      clearTimeout(timer);
      timer = null;
      out("bestmove e2e4");
    }
  } else if (line === "quit") quit();
});
