import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import type {
  EngineBestMove,
  EngineConfig,
  EngineError,
  EngineInfo,
  EngineTestResult,
  ReviewCompleted,
  ReviewFailed,
  ReviewMoveCompleted,
  ReviewProgress,
  StartLiveAnalysisInput,
  StartEngineGameInput
} from "@chaturanga/shared/types/engine";
import { parseBestMove, parseInfoLine } from "@chaturanga/shared/engine/uci";
import { logger, errorMessage } from "../logger";
import { engineConfigForId, engineResourceOptions } from "./engine-config";
import { createLineSplitter, LOG_UCI, spawnUciProcess, stopUciProcess, writeUci } from "./uci-process";

export type EngineEvents = {
  info: [EngineInfo];
  bestmove: [EngineBestMove];
  error: [EngineError];
  reviewProgress: [ReviewProgress];
  reviewMoveCompleted: [ReviewMoveCompleted];
  reviewCompleted: [ReviewCompleted];
  reviewFailed: [ReviewFailed];
};

type LineWaiter = {
  predicate: (line: string) => boolean;
  resolve: () => void;
  reject: (error: Error) => void;
};

/** LC0 waits for NN weights load before emitting `uciok`; Stockfish resolves almost immediately. */
const ENGINE_TEST_UCIOK_MS = 60_000;
const ENGINE_PLAY_UCIOK_MS = 120_000;
const ENGINE_PLAY_READY_MS = 30_000;
const UCIOK_TIMEOUT_MESSAGE =
  "Timed out waiting for uciok. Leela Chess Zero must load NN weights — set the weights file or add `--weights=/path/to/weights.pb.gz`.";

/** Throws when `config` can't be spawned as a native UCI process. */
export function assertSpawnable(config: EngineConfig | null): asserts config is EngineConfig {
  if (!config) throw new Error("Engine not found");
  if (!config.isAvailable) throw new Error("Engine binary is not available.");
}

function positionCommand(fen: string, moves: readonly string[]): string {
  return `position fen ${fen}${moves.length ? ` moves ${moves.join(" ")}` : ""}`;
}

/**
 * Owns the single interactive engine (engine games and live analysis) and
 * relays its output as typed events. Game review and draw probes run their
 * own short-lived processes.
 */
export class EngineManager extends EventEmitter<EngineEvents> {
  private process: ChildProcessWithoutNullStreams | null = null;
  private activeEngine: EngineConfig | null = null;
  private handshakeComplete = false;
  private lineWaiter: LineWaiter | null = null;
  private cancelledReviewIds = new Set<string>();

  cancelReview(reviewId: string): void {
    this.cancelledReviewIds.add(reviewId);
  }

  isReviewCancelled(reviewId: string): boolean {
    return this.cancelledReviewIds.has(reviewId);
  }

  clearReviewCancellation(reviewId: string): void {
    this.cancelledReviewIds.delete(reviewId);
  }

  /** Spawns the engine, waits for `uciok` and reports its id. */
  async testEngine(idOrConfig: string | EngineConfig): Promise<EngineTestResult> {
    const config = typeof idOrConfig === "string" ? engineConfigForId(idOrConfig) : idOrConfig;
    try {
      assertSpawnable(config);
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }

    return new Promise((resolve) => {
      const proc = spawnUciProcess(config);
      let name: string | undefined;
      let author: string | undefined;
      let settled = false;
      const finish = (result: EngineTestResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        stopUciProcess(proc);
        resolve(result);
      };
      const timeout = setTimeout(
        () => finish({ ok: false, error: "Timed out waiting for uciok (NN engines such as lc0 may need --weights)" }),
        ENGINE_TEST_UCIOK_MS
      );

      proc.stdout.on(
        "data",
        createLineSplitter((line) => {
          if (line.startsWith("id name ")) name = line.slice(8).trim();
          else if (line.startsWith("id author ")) author = line.slice(10).trim();
          else if (line === "uciok") {
            const isHumanPrediction = Boolean(
              name?.toLowerCase().includes("maia") || author?.toLowerCase().includes("maia")
            );
            finish({ ok: true, name, author, isHumanPrediction });
          }
        })
      );
      proc.on("exit", (code, signal) =>
        finish({
          ok: false,
          error: signal
            ? "Engine exited during handshake (terminated)."
            : `Engine exited during handshake (code ${code ?? 0}). Check args and weights path.`
        })
      );
      proc.on("error", (error) => finish({ ok: false, error: error.message }));
      writeUci(proc, "uci");
    });
  }

  /** Starts an engine game move search from the given position. */
  async start(input: StartEngineGameInput): Promise<void> {
    await this.launch(input.engineId, {
      begin: () => {
        this.write("ucinewgame");
        this.write(positionCommand(input.fen, input.moves));
        if (input.clock) {
          const { wtime, btime, winc, binc } = input.clock;
          this.write(
            `go wtime ${Math.max(1, Math.round(wtime))} btime ${Math.max(1, Math.round(btime))} ` +
              `winc ${Math.max(0, Math.round(winc))} binc ${Math.max(0, Math.round(binc))}`
          );
        } else if (input.depth) this.write(`go depth ${input.depth}`);
        else this.write(`go movetime ${input.moveTimeMs ?? 1000}`);
      }
    });
  }

  /** Starts an infinite MultiPV search for the live analysis panel. */
  async startAnalysis(input: StartLiveAnalysisInput): Promise<void> {
    const multipv = Math.max(1, Math.min(Math.round(input.multipv ?? 3), 5));
    await this.launch(input.engineId, {
      configure: (supportedOptions) => {
        // Same Threads/Hash settings as Game Review; only for engines that advertise them.
        const resources = engineResourceOptions();
        if (supportedOptions.has("Threads")) this.write(`setoption name Threads value ${resources.threads}`);
        if (supportedOptions.has("Hash")) this.write(`setoption name Hash value ${resources.hashMb}`);
        this.write(`setoption name MultiPV value ${multipv}`);
      },
      begin: () => {
        this.write(positionCommand(input.fen, input.moves));
        this.write("go infinite");
      }
    });
  }

  stop(): void {
    this.rejectLineWaiter("Engine stopped");
    if (!this.process) return;
    this.write("stop");
    stopUciProcess(this.process);
    this.process = null;
    this.activeEngine = null;
    this.handshakeComplete = false;
  }

  /**
   * Replaces the running engine: spawn, `uci` handshake (collecting advertised
   * options), optional `setoption`s, `isready`, then `begin()` sends the search.
   */
  private async launch(
    engineId: string,
    steps: { configure?: (supportedOptions: Set<string>) => void; begin: () => void }
  ): Promise<void> {
    this.stop();
    const config = engineConfigForId(engineId);
    assertSpawnable(config);

    const proc = spawnUciProcess(config);
    this.process = proc;
    this.activeEngine = config;
    this.handshakeComplete = false;

    proc.stdout.on("data", createLineSplitter((line) => this.handleLine(proc, line)));
    proc.stderr.on("data", (chunk: Buffer) => {
      if (LOG_UCI) logger.info(`uci:${config.name}`, "[stderr]", chunk.toString("utf8").trim());
    });
    proc.on("error", (error) => this.emit("error", { engineId: config.id, message: error.message }));
    proc.on("exit", (code) => {
      if (this.process !== proc) return;
      this.process = null;
      this.activeEngine = null;
      if (!this.handshakeComplete) {
        this.rejectLineWaiter(
          `Engine exited before UCI handshake completed${code !== null ? ` (exit ${code})` : ""}. For lc0 set the weights file in settings or add --weights=/path/to/net.pb.gz in args.`
        );
      }
    });

    try {
      const supportedOptions = new Set<string>();
      const uciOk = this.waitForLine((line) => {
        const option = line.match(/^option name (.+?) type /);
        if (option) supportedOptions.add(option[1]);
        return line === "uciok";
      }, ENGINE_PLAY_UCIOK_MS, UCIOK_TIMEOUT_MESSAGE);
      this.write("uci");
      await uciOk;
      steps.configure?.(supportedOptions);

      const readyOk = this.waitForLine(
        (line) => line === "readyok",
        ENGINE_PLAY_READY_MS,
        "Timed out waiting for readyok after isready."
      );
      this.write("isready");
      await readyOk;

      this.handshakeComplete = true;
      steps.begin();
    } catch (error) {
      this.emit("error", { engineId: config.id, message: errorMessage(error) });
      if (this.process === proc) {
        stopUciProcess(proc);
        this.process = null;
        this.activeEngine = null;
      }
      throw error;
    }
  }

  private write(command: string): void {
    if (LOG_UCI && this.activeEngine) logger.info(`uci:${this.activeEngine.name}`, "→", command);
    writeUci(this.process, command);
  }

  private waitForLine(predicate: (line: string) => boolean, timeoutMs: number, timeoutMessage: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => settle(new Error(timeoutMessage)), timeoutMs);
      const settle = (error?: Error) => {
        clearTimeout(timeout);
        if (this.lineWaiter === waiter) this.lineWaiter = null;
        if (error) reject(error);
        else resolve();
      };
      const waiter: LineWaiter = { predicate, resolve: () => settle(), reject: settle };
      this.lineWaiter = waiter;
    });
  }

  private rejectLineWaiter(reason: string): void {
    this.lineWaiter?.reject(new Error(reason));
  }

  private handleLine(proc: ChildProcessWithoutNullStreams, line: string): void {
    const engine = this.activeEngine;
    if (this.process !== proc || !engine) return;
    if (LOG_UCI) logger.info(`uci:${engine.name}`, "←", line);

    if (!this.handshakeComplete) {
      if (this.lineWaiter?.predicate(line)) this.lineWaiter.resolve();
      return;
    }
    const bestMove = parseBestMove(engine.id, line);
    if (bestMove) {
      this.emit("bestmove", bestMove);
      return;
    }
    const info = parseInfoLine(engine.id, line);
    if (info) this.emit("info", info);
  }
}
