import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import type { AnalysisLine, EngineConfig, EngineInfo } from "@chaturanga/shared/types/engine";
import { parseInfoLine } from "@chaturanga/shared/engine/uci";
import { engineDisplayName } from "@chaturanga/shared/engine/managed";
import { logger } from "../logger";
import { reviewAnalysisTimeoutMs, type ResolvedReviewSearch } from "./review-search";
import { linesFromInfoStream } from "./review-analysis";
import {
  createLineSplitter,
  LOG_UCI,
  spawnUciProcess,
  stopUciProcess,
  writeUci
} from "./uci-process";
import {
  createUciIdentity,
  readHandshakeLine,
  UCIOK_TIMEOUT_MESSAGE,
  UCIOK_TIMEOUT_MS
} from "./uci-handshake";

type LineEvents = {
  line: [string];
  // Not "error": EventEmitter throws on an "error" nobody listens to, and an
  // engine can die between searches.
  failure: [Error];
};

/**
 * One UCI engine process for a review: the handshake and MultiPV searches, with timeouts that leave diagnostics in the log and stop a search cleanly.
 */
export class UciReviewSession {
  private process: ChildProcessWithoutNullStreams | null = null;
  private events = new EventEmitter<LineEvents>();
  private supportedOptions = new Set<string>();
  /** Rolling tails for timeout diagnostics. */
  private recentLines: string[] = [];
  private recentStderr: string[] = [];
  private recentCommands: string[] = [];
  private currentMultipv = 1;
  /** Set once the process died; later waits reject immediately instead of timing out. */
  private failure: Error | null = null;
  engineName: string | null = null;
  appliedThreads: number | null = null;
  appliedHashMb: number | null = null;

  /** `shouldCancel` is polled while waiting for the engine (startup included), not only mid-search. */
  constructor(
    private config: EngineConfig,
    private shouldCancel?: () => boolean
  ) {}

  async start(options: { multipv?: number; threads?: number; hashMb?: number }): Promise<void> {
    const tag = `uci:${this.config.name}`;
    if (LOG_UCI) logger.trace(tag, "spawn", this.config.executablePath, this.config.args);
    this.process = spawnUciProcess(this.config);

    this.process.stdout.on(
      "data",
      createLineSplitter((line) => this.handleLine(line))
    );
    // Lc0 prints banners / progress to stderr; not a failure. Captured for diagnostics.
    this.process.stderr.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split(/\r?\n/)) {
        if (!line.trim()) continue;
        if (LOG_UCI) logger.trace(tag, "[stderr]", line);
        pushTail(this.recentStderr, line);
      }
    });
    this.process.on("error", (error) => this.fail(error));
    this.process.on("exit", (code) => {
      if (this.process)
        this.fail(
          new Error(
            `${engineDisplayName(this.config.name)} exited unexpectedly (code ${code ?? "unknown"})`
          )
        );
    });

    const identity = createUciIdentity();
    identity.options = this.supportedOptions;
    const uciReady = this.waitFor(
      (line) => readHandshakeLine(identity, line),
      UCIOK_TIMEOUT_MS,
      UCIOK_TIMEOUT_MESSAGE
    );
    this.write("uci");
    await uciReady;
    this.engineName = identity.name ?? null;

    if (options.threads && this.setOption("Threads", String(options.threads)))
      this.appliedThreads = options.threads;
    if (options.hashMb && this.setOption("Hash", String(options.hashMb)))
      this.appliedHashMb = options.hashMb;
    this.setOption("UCI_ShowWDL", "true");
    this.currentMultipv = options.multipv ?? 1;
    this.setOption("MultiPV", String(this.currentMultipv));
    await this.ready();
    this.write("ucinewgame");
  }

  /** MultiPV search of `fen`; resolves with the final lines when the engine prints bestmove. */
  async analyze(input: {
    fen: string;
    multipv: number;
    search: ResolvedReviewSearch;
    /** Restricts the search to these moves (UCI `searchmoves`, sent last). */
    searchMoves?: readonly string[];
    shouldCancel?: () => boolean;
    /** Overrides the budget's own timeout. */
    timeoutMs?: number;
  }): Promise<AnalysisLine[]> {
    if (input.multipv !== this.currentMultipv) {
      this.currentMultipv = input.multipv;
      this.setOption("MultiPV", String(input.multipv));
    }
    const bound =
      input.search.nodes !== null && input.search.nodes > 0
        ? `go nodes ${input.search.nodes}`
        : input.search.moveTimeMs
          ? `go movetime ${input.search.moveTimeMs}`
          : `go depth ${input.search.depth}`;
    const go = input.searchMoves?.length
      ? `${bound} searchmoves ${input.searchMoves.join(" ")}`
      : bound;
    const infos: EngineInfo[] = [];
    await this.search({
      fen: input.fen,
      go,
      timeoutMs:
        input.timeoutMs ??
        reviewAnalysisTimeoutMs({
          moveTimeMs: input.search.moveTimeMs,
          depth: input.search.depth,
          multipv: input.multipv,
          nodes: input.search.nodes
        }),
      shouldCancel: input.shouldCancel,
      onLine: (line) => {
        const info = parseInfoLine(this.config.id, line);
        if (info?.score && info.pv?.length) infos.push(info);
      }
    });
    return linesFromInfoStream(input.fen, infos);
  }

  stop(): void {
    const proc = this.process;
    this.process = null;
    stopUciProcess(proc);
  }

  private fail(error: Error): void {
    this.failure ??= error;
    this.events.emit("failure", error);
  }

  /** Sends `setoption` only for options the engine advertised. Returns whether it was sent. */
  private setOption(name: string, value: string): boolean {
    if (!this.supportedOptions.has(name)) return false;
    this.write(`setoption name ${name} value ${value}`);
    return true;
  }

  private async ready(): Promise<void> {
    const engineReady = this.waitFor(
      (line) => line === "readyok",
      25_000,
      "Timed out waiting for readyok"
    );
    this.write("isready");
    await engineReady;
  }

  private async search(input: {
    fen: string;
    go: string;
    timeoutMs: number;
    shouldCancel?: () => boolean;
    onLine: (line: string) => void;
  }): Promise<void> {
    await this.ready();
    this.write(`position fen ${input.fen}`);
    let received = 0;
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        clearInterval(cancelInterval);
        this.events.off("line", onLine);
        this.events.off("failure", onError);
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onLine = (line: string) => {
        if (line.startsWith("bestmove")) {
          cleanup();
          resolve();
          return;
        }
        received += 1;
        input.onLine(line);
      };
      const timeout = setTimeout(() => {
        cleanup();
        const snapshot = this.debugSnapshot();
        const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
        const diagnostics = [
          ``,
          `╔══ ENGINE TIMEOUT ══════════════════════════════════════════════════════`,
          `║ engine:     ${this.config.name}`,
          `║ executable: ${this.config.executablePath}`,
          `║ weights:    ${this.config.weightsPath ?? "(none)"}`,
          `║ command:    ${input.go}`,
          `║ fen:        ${input.fen}`,
          `║ elapsed:    ${elapsedSeconds}s of ${Math.round(input.timeoutMs / 1000)}s budget`,
          `║ lines:      ${received} received before timeout`,
          `╠── last 10 commands sent ───────────────────────────────────────────────`,
          ...snapshot.commands.slice(-10).map((c) => `║   → ${c}`),
          `╠── last 10 stdout lines ────────────────────────────────────────────────`,
          ...snapshot.lines.slice(-10).map((l) => `║   ← ${l}`),
          `╠── last 10 stderr lines ────────────────────────────────────────────────`,
          ...(snapshot.stderr.length > 0
            ? snapshot.stderr.slice(-10).map((l) => `║   ⚠ ${l}`)
            : [`║   (none)`]),
          `╚════════════════════════════════════════════════════════════════════════`
        ].join("\n");
        logger.error("review", `engine timeout${diagnostics}`);
        const error = new Error(
          `${engineDisplayName(this.config.name)} did not answer "${input.go}" within ${elapsedSeconds}s.`
        );
        // Stop the search and take its bestmove, so the next search doesn't read it as its own. An
        // engine that won't stop is broken: every later wait fails at once.
        this.write("stop");
        this.waitFor(
          (line) => line.startsWith("bestmove"),
          STOP_DRAIN_MS,
          "No bestmove after stop"
        ).then(
          () => reject(error),
          () => {
            this.fail(error);
            reject(error);
          }
        );
      }, input.timeoutMs);
      let stopSent = false;
      const cancelInterval = setInterval(() => {
        if (stopSent) return;
        if (input.shouldCancel?.()) {
          stopSent = true;
          this.write("stop");
        }
      }, 100);

      this.events.on("line", onLine);
      this.events.on("failure", onError);
      this.write(input.go);
    });
  }

  private write(command: string): void {
    if (LOG_UCI) logger.trace(`uci:${this.config.name}`, "→", command);
    pushTail(this.recentCommands, command);
    writeUci(this.process, command);
  }

  private debugSnapshot(): { commands: string[]; lines: string[]; stderr: string[] } {
    return {
      commands: [...this.recentCommands],
      lines: [...this.recentLines],
      stderr: [...this.recentStderr]
    };
  }

  private waitFor(
    predicate: (line: string) => boolean,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<string> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.shouldCancel?.()) return Promise.reject(new Error("Review cancelled"));
    return new Promise((resolve, reject) => {
      const cancelPoll = this.shouldCancel
        ? setInterval(() => {
            if (!this.shouldCancel?.()) return;
            cleanup();
            reject(new Error("Review cancelled"));
          }, CANCEL_POLL_MS)
        : null;
      const cleanup = () => {
        if (cancelPoll) clearInterval(cancelPoll);
        clearTimeout(timeout);
        this.events.off("line", onLine);
        this.events.off("failure", onError);
      };
      const onLine = (line: string) => {
        if (!predicate(line)) return;
        cleanup();
        resolve(line);
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(timeoutMessage));
      }, timeoutMs);
      this.events.on("line", onLine);
      this.events.on("failure", onError);
    });
  }

  private handleLine(line: string): void {
    if (LOG_UCI) logger.trace(`uci:${this.config.name}`, "←", line);
    pushTail(this.recentLines, line);
    this.events.emit("line", line);
  }
}

/** How long a timed-out search may take to stop before the engine counts as broken. */
const STOP_DRAIN_MS = 5_000;

/** How often a wait for the engine checks whether the review was cancelled. */
const CANCEL_POLL_MS = 100;

function pushTail(buffer: string[], line: string): void {
  buffer.push(line);
  if (buffer.length > 50) buffer.shift();
}
