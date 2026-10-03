// Scripted UCI engine for EngineManager tests. argv[2] = a log file: one line per process start
// ("spawn"), per command received and per exit ("exit"), so tests can count spawns and check what was sent.
// `go infinite` streams info lines until `stop`; any other `go` answers after 30 ms.
// argv[3] = "slow-start": `uciok` only after 10 s (a large network loading); "slow-exit": quit and
// SIGTERM take 300 ms to end the process (a network being freed); "stubborn": both are ignored;
// "lines": `go infinite` streams three lines that fit the position (LINES below, by the moves after
// the start position), and none for a position it doesn't know.
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
const mode = process.argv[3];
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
  if (line === "uci") {
    out("id name Fake live");
    for (const name of ["Threads", "Hash", "MultiPV"]) out(`option name ${name} type spin default 1 min 1 max 512`);
    if (mode === "slow-start") setTimeout(() => out("uciok"), 10_000);
    else out("uciok");
  } else if (line === "isready") out("readyok");
  else if (line === "go infinite") {
    depth = 0;
    const lines = mode === "lines" ? (LINES[positionMoves] ?? []) : null;
    timer = setInterval(() => {
      depth += 1;
      if (!lines) out(`info depth ${depth} multipv 1 score cp 20 nodes ${depth * 100} pv e2e4 e7e5`);
      else if (!lines.length) out(`info depth ${depth} multipv 1 score cp 0 nodes ${depth * 100}`);
      lines?.forEach((pv, index) =>
        out(`info depth ${depth} multipv ${index + 1} score cp ${30 - index * 25} nodes ${depth * 100} pv ${pv}`)
      );
    }, 5);
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
