import { BrowserWindow } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import type {
  EngineBestMove,
  EngineConfig,
  EngineError,
  EngineInfo,
  EngineTestResult,
  StartEngineGameInput
} from "../../shared/types/engine";
import { engineRepository } from "../db/repositories";
import { parseBestMove, parseInfoLine } from "./uci";

type EngineEvents = {
  info: [EngineInfo];
  bestmove: [EngineBestMove];
  error: [EngineError];
};

export class EngineManager extends EventEmitter<EngineEvents> {
  private process: ChildProcessWithoutNullStreams | null = null;
  private activeEngine: EngineConfig | null = null;
  private lineBuffer = "";
  private lastInfoAt = 0;

  async testEngine(idOrConfig: string | EngineConfig): Promise<EngineTestResult> {
    const config = typeof idOrConfig === "string" ? engineRepository.get(idOrConfig) : idOrConfig;
    if (!config) return { ok: false, error: "Engine not found" };

    return new Promise((resolve) => {
      const proc = spawn(config.executablePath, config.args, {
        cwd: config.workingDirectory ?? undefined,
        stdio: "pipe"
      });
      let output = "";
      let name: string | undefined;
      let author: string | undefined;
      const timeout = setTimeout(() => {
        proc.kill();
        resolve({ ok: false, error: "Timed out waiting for uciok" });
      }, 5000);

      proc.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
        for (const line of output.split(/\r?\n/)) {
          if (line.startsWith("id name ")) name = line.slice(8).trim();
          if (line.startsWith("id author ")) author = line.slice(10).trim();
          if (line === "uciok") {
            clearTimeout(timeout);
            proc.stdin.write("quit\n");
            resolve({ ok: true, name, author });
          }
        }
      });

      proc.on("error", (error) => {
        clearTimeout(timeout);
        resolve({ ok: false, error: error.message });
      });

      proc.stdin.write("uci\n");
    });
  }

  async start(input: StartEngineGameInput): Promise<void> {
    this.stop();
    const config = engineRepository.get(input.engineId);
    if (!config) throw new Error("Engine not found");
    this.activeEngine = config;

    const proc = spawn(config.executablePath, config.args, {
      cwd: config.workingDirectory ?? undefined,
      stdio: "pipe"
    });
    this.process = proc;
    this.lineBuffer = "";

    proc.stdout.on("data", (chunk: Buffer) => this.handleStdout(chunk));
    proc.stderr.on("data", (chunk: Buffer) => {
      this.emit("error", { engineId: config.id, message: chunk.toString("utf8").trim() });
    });
    proc.on("error", (error) => this.emit("error", { engineId: config.id, message: error.message }));
    proc.on("exit", () => {
      if (this.process === proc) this.process = null;
    });

    this.write("uci");
    this.write("isready");
    this.write("ucinewgame");
    this.write(`position fen ${input.fen}${input.moves.length ? ` moves ${input.moves.join(" ")}` : ""}`);
    if (input.depth) this.write(`go depth ${input.depth}`);
    else this.write(`go movetime ${input.moveTimeMs ?? 1000}`);
  }

  stop(): void {
    if (!this.process) return;
    this.write("stop");
    this.write("quit");
    this.process.kill();
    this.process = null;
    this.activeEngine = null;
  }

  bindWindow(window: BrowserWindow): void {
    this.on("info", (info) => window.webContents.send("engine:info", info));
    this.on("bestmove", (move) => window.webContents.send("engine:bestmove", move));
    this.on("error", (error) => window.webContents.send("engine:error", error));
  }

  private write(command: string): void {
    this.process?.stdin.write(`${command}\n`);
  }

  private handleStdout(chunk: Buffer): void {
    if (!this.activeEngine) return;
    this.lineBuffer += chunk.toString("utf8");
    const lines = this.lineBuffer.split(/\r?\n/);
    this.lineBuffer = lines.pop() ?? "";

    for (const line of lines.map((item) => item.trim()).filter(Boolean)) {
      const bestMove = parseBestMove(this.activeEngine.id, line);
      if (bestMove) {
        this.emit("bestmove", bestMove);
        continue;
      }

      const info = parseInfoLine(this.activeEngine.id, line);
      if (info && Date.now() - this.lastInfoAt > 120) {
        this.lastInfoAt = Date.now();
        this.emit("info", info);
      }
    }
  }
}
