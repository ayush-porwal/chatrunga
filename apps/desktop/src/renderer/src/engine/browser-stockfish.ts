import stockfishWorkerUrl from "stockfish/bin/stockfish-18-lite-single.js?url";
import stockfishWasmUrl from "stockfish/bin/stockfish-18-lite-single.wasm?url";
import { BUNDLED_STOCKFISH_ID } from "@chaturanga/shared/engine/bundled";
import { parseBestMove, parseInfoLine } from "@chaturanga/shared/engine/uci";
import type {
  EngineBestMove,
  EngineInfo,
  StartEngineGameInput,
  StartLiveAnalysisInput
} from "@chaturanga/shared/types/engine";

type LineListener = (line: string) => void;

let worker: Worker | null = null;
let readyPromise: Promise<void> | null = null;
const listeners = new Set<LineListener>();

export function canRunInBrowser(engineId: string | null | undefined): boolean {
  return engineId === BUNDLED_STOCKFISH_ID;
}

export async function startBrowserEngineGame(
  input: StartEngineGameInput,
  onInfo: (info: EngineInfo) => void
): Promise<EngineBestMove | null> {
  await ensureReady();
  const active = worker;
  if (!active) return null;
  active.postMessage("stop");
  configurePosition(input.fen, input.moves);
  return search(input.engineId, goCommand(input), onInfo);
}

export async function startBrowserAnalysis(
  input: StartLiveAnalysisInput,
  onInfo: (info: EngineInfo) => void
): Promise<void> {
  await ensureReady();
  const active = worker;
  if (!active) return;
  active.postMessage("stop");
  active.postMessage(`setoption name MultiPV value ${Math.max(1, input.multipv ?? 3)}`);
  configurePosition(input.fen, input.moves);
  active.postMessage("go infinite");
  const listener: LineListener = (line) => {
    const info = parseInfoLine(input.engineId, line);
    if (info) onInfo(info);
  };
  listeners.add(listener);
}

export function stopBrowserEngine(): void {
  if (!worker) return;
  worker.postMessage("stop");
  listeners.clear();
}

async function ensureReady(): Promise<void> {
  if (readyPromise) return readyPromise;
  readyPromise = new Promise((resolve, reject) => {
    const wasmUrl = new URL(stockfishWasmUrl, window.location.href).href;
    const scriptUrl = new URL(stockfishWorkerUrl, window.location.href).href;
    worker = new Worker(`${scriptUrl}#${encodeURIComponent(wasmUrl)},worker`);
    worker.addEventListener("message", (event) => {
      const line = String(event.data ?? "");
      for (const listener of listeners) listener(line);
    });
    worker.addEventListener("error", () => {
      reject(new Error("Bundled Stockfish failed to load."));
    }, { once: true });
    waitForLine((line) => line === "uciok", 15_000).then(() => {
      worker?.postMessage("isready");
      return waitForLine((line) => line === "readyok", 15_000);
    }).then(() => resolve(), reject);
    worker.postMessage("uci");
  });
  return readyPromise;
}

function configurePosition(fen: string, moves: string[]): void {
  const suffix = moves.length ? ` moves ${moves.join(" ")}` : "";
  worker?.postMessage(`position fen ${fen}${suffix}`);
}

function goCommand(input: StartEngineGameInput): string {
  if (input.clock) {
    return [
      "go",
      `wtime ${input.clock.wtime}`,
      `btime ${input.clock.btime}`,
      `winc ${input.clock.winc}`,
      `binc ${input.clock.binc}`
    ].join(" ");
  }
  if (input.depth && input.depth > 0) return `go depth ${input.depth}`;
  return `go movetime ${Math.max(50, input.moveTimeMs ?? 1000)}`;
}

function search(
  engineId: string,
  command: string,
  onInfo: (info: EngineInfo) => void
): Promise<EngineBestMove | null> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      listeners.delete(listener);
      reject(new Error("Bundled Stockfish timed out."));
    }, 60_000);
    const listener: LineListener = (line) => {
      const info = parseInfoLine(engineId, line);
      if (info) onInfo(info);
      const bestMove = parseBestMove(engineId, line);
      if (!bestMove) return;
      window.clearTimeout(timeout);
      listeners.delete(listener);
      resolve(bestMove);
    };
    listeners.add(listener);
    worker?.postMessage(command);
  });
}

function waitForLine(predicate: (line: string) => boolean, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      listeners.delete(listener);
      reject(new Error("Bundled Stockfish did not become ready."));
    }, timeoutMs);
    const listener: LineListener = (line) => {
      if (!predicate(line)) return;
      window.clearTimeout(timeout);
      listeners.delete(listener);
      resolve(line);
    };
    listeners.add(listener);
  });
}
