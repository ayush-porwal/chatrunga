import { BrowserWindow } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
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
import { spawnArgsForEngine, engineProcessCwd } from "@chaturanga/shared/engine/spawn-args";
import { engineConfigForId } from "./engine-config";
import { parseBestMove, parseInfoLine } from "./uci";

type EngineEvents = {
  info: [EngineInfo];
  bestmove: [EngineBestMove];
  error: [EngineError];
  reviewProgress: [ReviewProgress];
  reviewMoveCompleted: [ReviewMoveCompleted];
  reviewCompleted: [ReviewCompleted];
  reviewFailed: [ReviewFailed];
};

type LineWaitQueueEntry = {
  predicate: (line: string) => boolean;
  timeoutHandle: ReturnType<typeof setTimeout>;
  resolvePending: () => void;
  rejectPending: (error: Error) => void;
};

/** LC0 waits for NN weights load before emitting `uciok`; Stockfish resolves almost immediately. */
const ENGINE_TEST_UCIOK_MS = 60_000;
const ENGINE_PLAY_UCIOK_MS = 120_000;
const ENGINE_PLAY_READY_MS = 30_000;

export class EngineManager extends EventEmitter<EngineEvents> {
  private process: ChildProcessWithoutNullStreams | null = null;
  private activeEngine: EngineConfig | null = null;
  private lineBuffer = "";
  private cancelledReviewIds = new Set<string>();
  private handshakeComplete = false;
  private lineWaitQueue: LineWaitQueueEntry[] = [];

  cancelReview(reviewId: string): void {
    this.cancelledReviewIds.add(reviewId);
  }

  isReviewCancelled(reviewId: string): boolean {
    return this.cancelledReviewIds.has(reviewId);
  }

  clearReviewCancellation(reviewId: string): void {
    this.cancelledReviewIds.delete(reviewId);
  }

  async testEngine(idOrConfig: string | EngineConfig): Promise<EngineTestResult> {
    const config = typeof idOrConfig === "string" ? engineConfigForId(idOrConfig) : idOrConfig;
    if (!config) return { ok: false, error: "Engine not found" };
    if (config.runtime === "wasm") return { ok: false, error: "Browser WASM engines run in the renderer." };
    if (!config.isAvailable) return { ok: false, error: "Bundled engine binary is not available for this platform build." };

    return new Promise((resolve) => {
      let resolved = false;
      const proc = spawn(config.executablePath, spawnArgsForEngine(config), {
        cwd: engineProcessCwd(config),
        stdio: "pipe"
      });
      let name: string | undefined;
      let author: string | undefined;
      const timeout = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        proc.kill();
        resolve({ ok: false, error: "Timed out waiting for uciok (NN engines such as lc0 may need --weights)" });
      }, ENGINE_TEST_UCIOK_MS);

      proc.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        const lines = text.split(/\r?\n/);
        for (let line of lines) {
          line = line.trim();
          if (!line) continue;
          if (line.startsWith("id name ")) name = line.slice(8).trim();
          if (line.startsWith("id author ")) author = line.slice(10).trim();
          if (line === "uciok" && !resolved) {
            resolved = true;
            clearTimeout(timeout);
            proc.stdin.write("quit\n");
            resolve({ ok: true, name, author });
            return;
          }
        }
      });

      proc.on("exit", (code, signal) => {
        clearTimeout(timeout);
        if (resolved) return;
        resolved = true;
        resolve({
          ok: false,
          error: signal
            ? "Engine exited during handshake (terminated)."
            : `Engine exited during handshake (code ${code ?? 0}). Check args and weights path.`
        });
      });

      proc.on("error", (error) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        resolve({ ok: false, error: error.message });
      });

      proc.stdin.write("uci\n");
    });
  }

  async start(input: StartEngineGameInput): Promise<void> {
    this.stop();
    const config = engineConfigForId(input.engineId);
    if (!config) throw new Error("Engine not found");
    if (config.runtime === "wasm") throw new Error("Browser WASM engines run in the renderer.");
    if (!config.isAvailable) throw new Error("Bundled engine binary is not available for this platform build.");
    this.activeEngine = config;
    this.handshakeComplete = false;

    const proc = spawn(config.executablePath, spawnArgsForEngine(config), {
      cwd: engineProcessCwd(config),
      stdio: "pipe"
    });
    this.process = proc;
    this.lineBuffer = "";

    proc.stdout.on("data", (chunk: Buffer) => this.handleStdout(chunk));
    proc.stderr.on("data", (chunk: Buffer) => {
      const message = chunk.toString("utf8").trim();
      if (message)
        console.warn(`[uci engine stderr id=${config.id}]`, message);
    });
    proc.on("error", (error) =>
      this.emit("error", { engineId: config.id, message: error.message })
    );
    proc.on("exit", (code) => {
      if (this.process !== proc) return;
      this.process = null;
      if (!this.handshakeComplete) {
        this.cancelLineWaits(
          `Engine exited before UCI handshake completed${code !== null ? ` (exit ${code})` : ""}. For lc0 set the weights file in settings or add --weights=/path/to/net.pb.gz in args.`
        );
      }
      if (this.activeEngine?.id === config.id) this.activeEngine = null;
    });

    try {
      this.lineWaitQueue = [];
      const uciOk = this.enqueueLineWait(
        (line) => line === "uciok",
        ENGINE_PLAY_UCIOK_MS,
        "Timed out waiting for uciok. Leela Chess Zero must load NN weights — add launcher args such as `--weights=/path/to/weights.pb.gz`."
      );
      this.write("uci");
      await uciOk;

      const readyOk = this.enqueueLineWait(
        (line) => line === "readyok",
        ENGINE_PLAY_READY_MS,
        "Timed out waiting for readyok after isready."
      );
      this.write("isready");
      await readyOk;

      this.handshakeComplete = true;

      this.write("ucinewgame");
      this.write(`position fen ${input.fen}${input.moves.length ? ` moves ${input.moves.join(" ")}` : ""}`);
      if (input.clock) {
        const c = input.clock;
        const wt = Math.max(1, Math.round(c.wtime));
        const bt = Math.max(1, Math.round(c.btime));
        const wi = Math.max(0, Math.round(c.winc));
        const bi = Math.max(0, Math.round(c.binc));
        this.write(`go wtime ${wt} btime ${bt} winc ${wi} binc ${bi}`);
      } else if (input.depth) this.write(`go depth ${input.depth}`);
      else this.write(`go movetime ${input.moveTimeMs ?? 1000}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit("error", { engineId: config.id, message });
      this.teardownRunningProcess(proc);
      this.activeEngine = null;
      throw error;
    }
  }

  async startAnalysis(input: StartLiveAnalysisInput): Promise<void> {
    this.stop();
    const config = engineConfigForId(input.engineId);
    if (!config) throw new Error("Engine not found");
    if (config.runtime === "wasm") throw new Error("Browser WASM engines run in the renderer.");
    if (!config.isAvailable) throw new Error("Bundled engine binary is not available for this platform build.");
    this.activeEngine = config;
    this.handshakeComplete = false;

    const proc = spawn(config.executablePath, spawnArgsForEngine(config), {
      cwd: engineProcessCwd(config),
      stdio: "pipe"
    });
    this.process = proc;
    this.lineBuffer = "";

    proc.stdout.on("data", (chunk: Buffer) => this.handleStdout(chunk));
    proc.stderr.on("data", (chunk: Buffer) => {
      const message = chunk.toString("utf8").trim();
      if (message) console.warn(`[uci analysis stderr id=${config.id}]`, message);
    });
    proc.on("error", (error) =>
      this.emit("error", { engineId: config.id, message: error.message })
    );
    proc.on("exit", (code) => {
      if (this.process !== proc) return;
      this.process = null;
      if (!this.handshakeComplete) {
        this.cancelLineWaits(
          `Engine exited before UCI handshake completed${code !== null ? ` (exit ${code})` : ""}.`
        );
      }
      if (this.activeEngine?.id === config.id) this.activeEngine = null;
    });

    try {
      this.lineWaitQueue = [];
      const multipv = Math.max(1, Math.min(Math.round(input.multipv ?? 3), 5));
      const uciOk = this.enqueueLineWait(
        (line) => line === "uciok",
        ENGINE_PLAY_UCIOK_MS,
        "Timed out waiting for uciok. Leela Chess Zero must load NN weights — add launcher args such as `--weights=/path/to/weights.pb.gz`."
      );
      this.write("uci");
      await uciOk;
      this.write(`setoption name MultiPV value ${multipv}`);

      const readyOk = this.enqueueLineWait(
        (line) => line === "readyok",
        ENGINE_PLAY_READY_MS,
        "Timed out waiting for readyok after isready."
      );
      this.write("isready");
      await readyOk;

      this.handshakeComplete = true;
      this.write(`position fen ${input.fen}${input.moves.length ? ` moves ${input.moves.join(" ")}` : ""}`);
      this.write("go infinite");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit("error", { engineId: config.id, message });
      this.teardownRunningProcess(proc);
      this.activeEngine = null;
      throw error;
    }
  }

  stop(): void {
    this.cancelLineWaits("Engine stopped");
    if (!this.process) return;
    this.write("stop");
    this.write("quit");
    this.process.kill();
    this.process = null;
    this.activeEngine = null;
    this.handshakeComplete = false;
  }

  bindWindow(window: BrowserWindow): void {
    this.on("info", (info) => window.webContents.send("engine:info", info));
    this.on("bestmove", (move) => window.webContents.send("engine:bestmove", move));
    this.on("error", (error) => window.webContents.send("engine:error", error));
    this.on("reviewProgress", (event) => window.webContents.send("review:progress", event));
    this.on("reviewMoveCompleted", (event) =>
      window.webContents.send("review:moveCompleted", event)
    );
    this.on("reviewCompleted", (event) => window.webContents.send("review:completed", event));
    this.on("reviewFailed", (event) => window.webContents.send("review:failed", event));
  }

  private write(command: string): void {
    this.process?.stdin.write(`${command}\n`);
  }

  private enqueueLineWait(
    predicate: (line: string) => boolean,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const entry: LineWaitQueueEntry = {
        predicate,
        timeoutHandle: 0 as unknown as ReturnType<typeof setTimeout>,
        resolvePending: () => {
          clearTimeout(entry.timeoutHandle);
          this.removeLineWaiter(entry);
          resolve();
        },
        rejectPending: (error: Error) => {
          clearTimeout(entry.timeoutHandle);
          this.removeLineWaiter(entry);
          reject(error);
        }
      };
      entry.timeoutHandle = setTimeout(
        () => entry.rejectPending(new Error(timeoutMessage)),
        timeoutMs
      );
      this.lineWaitQueue.push(entry);
    });
  }

  private removeLineWaiter(entry: LineWaitQueueEntry): void {
    const index = this.lineWaitQueue.indexOf(entry);
    if (index >= 0) this.lineWaitQueue.splice(index, 1);
  }

  private tryConsumeLineWaiter(line: string): boolean {
    const entry = this.lineWaitQueue[0];
    if (!entry || !entry.predicate(line)) return false;
    entry.resolvePending();
    return true;
  }

  private cancelLineWaits(reason: string): void {
    const error = new Error(reason);
    for (const entry of [...this.lineWaitQueue]) {
      entry.rejectPending(error);
    }
  }

  private teardownRunningProcess(proc: ChildProcessWithoutNullStreams): void {
    if (this.process !== proc) return;
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
    this.process = null;
    this.handshakeComplete = false;
  }

  private handleStdout(chunk: Buffer): void {
    if (!this.activeEngine) return;
    this.lineBuffer += chunk.toString("utf8");
    const lines = this.lineBuffer.split(/\r?\n/);
    this.lineBuffer = lines.pop() ?? "";

    for (const line of lines.map((item) => item.trim()).filter(Boolean)) {
      if (!this.handshakeComplete) {
        if (this.tryConsumeLineWaiter(line)) continue;
        continue;
      }

      const bestMove = parseBestMove(this.activeEngine.id, line);
      if (bestMove) {
        this.emit("bestmove", bestMove);
        continue;
      }

      const info = parseInfoLine(this.activeEngine.id, line);
      if (info) {
        this.emit("info", info);
      }
    }
  }
}
