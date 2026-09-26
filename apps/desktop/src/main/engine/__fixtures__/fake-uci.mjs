// Minimal scripted UCI engine for review pipeline tests.
// argv[2] = "sf" (MultiPV search output) or "maia" (replays captured lc0 VerboseMoveStats).
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const mode = process.argv[2] ?? "sf";
const here = dirname(fileURLToPath(import.meta.url));
const maiaLines = readFileSync(join(here, "maia-1100-italian.txt"), "utf8").split(/\r?\n/).filter(Boolean);
const out = (line) => process.stdout.write(`${line}\n`);
let multipv = 1;

createInterface({ input: process.stdin }).on("line", (raw) => {
  const line = raw.trim();
  if (line === "uci") {
    out(`id name Fake ${mode}`);
    for (const name of ["Threads", "Hash", "MultiPV"]) out(`option name ${name} type spin default 1 min 1 max 512`);
    out("option name UCI_ShowWDL type check default false");
    if (mode === "maia") {
      out("option name VerboseMoveStats type check default false");
      out("option name PolicyTemperature type string default 1.359000");
    }
    out("uciok");
  } else if (line === "isready") out("readyok");
  else if (line.startsWith("setoption name MultiPV value ")) multipv = Number(line.split(" ").pop());
  else if (line.startsWith("go")) {
    if (mode === "maia") {
      for (const item of maiaLines) out(item);
    } else {
      const moves = ["d1h5", "g2g4", "e2e4", "a2a3", "b2b3"];
      for (let pv = 1; pv <= multipv; pv += 1) {
        out(`info depth 6 seldepth 8 multipv ${pv} score cp ${60 - pv * 20} wdl 300 500 200 nodes 1000 pv ${moves[pv - 1]}`);
      }
      out(`bestmove ${moves[0]}`);
    }
  } else if (line === "quit") process.exit(0);
});
