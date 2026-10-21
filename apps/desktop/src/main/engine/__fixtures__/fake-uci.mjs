// Minimal scripted UCI engine for review pipeline tests: MultiPV search output.
// argv[2] = a name for the engine (`id name Fake <argv[2]>`).
// argv[3] = "slow-start": answers `uci` only after 10 s (a large network loading).
// argv[3] = "wait-for-stop": a search prints its lines at once but its bestmove only on `stop`;
// every command received is appended to the file argv[4].
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const name = process.argv[2] ?? "sf";
const out = (line) => process.stdout.write(`${line}\n`);
let multipv = 1;

const waitForStop = process.argv[3] === "wait-for-stop";

function answerUci() {
  if (process.argv[3] === "slow-start") {
    setTimeout(() => out("uciok"), 10_000);
    return;
  }
  out(`id name Fake ${name}`);
  for (const option of ["Threads", "Hash", "MultiPV"])
    out(`option name ${option} type spin default 1 min 1 max 512`);
  out("option name UCI_ShowWDL type check default false");
  out("uciok");
}

function answerGo() {
  const moves = ["d1h5", "g2g4", "e2e4", "a2a3", "b2b3"];
  for (let pv = 1; pv <= multipv; pv += 1) {
    out(
      `info depth 6 seldepth 8 multipv ${pv} score cp ${60 - pv * 20} wdl 300 500 200 nodes 1000 pv ${moves[pv - 1]}`
    );
  }
  if (!waitForStop) out(`bestmove ${moves[0]}`);
}

createInterface({ input: process.stdin }).on("line", (raw) => {
  const line = raw.trim();
  if (waitForStop) appendFileSync(process.argv[4], `${line}\n`);
  if (line === "uci") answerUci();
  else if (line === "isready") out("readyok");
  else if (line.startsWith("setoption name MultiPV value "))
    multipv = Number(line.split(" ").pop());
  else if (line.startsWith("go")) answerGo();
  else if (line === "stop" && waitForStop) out("bestmove d1h5");
  else if (line === "quit") process.exit(0);
});
