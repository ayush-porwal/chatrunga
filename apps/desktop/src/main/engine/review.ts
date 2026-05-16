import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import type {
  AnalysisLine,
  EngineConfig,
  EngineInfo,
  EngineScore,
  GameReview,
  GameReviewSummary,
  MoveReview,
  ReviewGameInput,
  ReviewMoveInputItem,
  ReviewProgressPhase
} from "@chaturanga/shared/types/engine";
import { fenAfterUci, moveFromUci, positionFromFen, statusForFen } from "@chaturanga/shared/chess/position";
import {
  classifyMove,
  scoreFromWhitePerspective,
  scoreToCentipawns
} from "@chaturanga/shared/chess/review";
import { spawnArgsForEngine, engineProcessCwd } from "@chaturanga/shared/engine/spawn-args";
import {
  resolveReviewSearchParams,
  reviewAnalysisTimeoutMs,
  type ResolvedReviewSearch
} from "./review-search";
import { parseBestMove, parseInfoLine } from "./uci";

type LineEvents = {
  line: [string];
  error: [Error];
};

type ReviewMoveInput = ReviewMoveInputItem;

export type ReviewProgressSink = {
  onPhaseProgress?: (input: {
    moveIndex: number;
    nodeId: string;
    san: string;
    ply: number;
    fenBefore: string;
    fenAfter: string;
    phase: ReviewProgressPhase;
    fen: string;
    mover: "white" | "black";
    depth: number;
    lines: AnalysisLine[];
  }) => void;
  onMoveCompleted?: (input: { moveIndex: number; move: MoveReview }) => void;
  shouldCancel?: () => boolean;
};

export async function reviewGameWithEngine(
  config: EngineConfig,
  input: ReviewGameInput,
  sink: ReviewProgressSink = {}
): Promise<GameReview> {
  const session = new UciReviewSession(config);
  const multipv = Math.max(1, Math.min(input.multipv ?? 3, 5));
  const search = resolveReviewSearchParams(input);

  try {
    await session.start(multipv);
    const moves: MoveReview[] = [];
    for (let index = 0; index < input.moves.length; index += 1) {
      if (sink.shouldCancel?.()) throw new Error("Review cancelled");
      const move = input.moves[index];
      const mover = statusForFen(move.fenBefore).turn;
      const beforeLines = await session.analyze({
        fen: move.fenBefore,
        multipv,
        search,
        shouldCancel: sink.shouldCancel,
        onProgress: (lines, latestDepth) =>
          sink.onPhaseProgress?.({
            moveIndex: index,
            nodeId: move.nodeId,
            san: move.san,
            ply: move.ply,
            fenBefore: move.fenBefore,
            fenAfter: move.fenAfter,
            phase: "before",
            fen: move.fenBefore,
            mover,
            depth: latestDepth,
            lines
          })
      });
      if (sink.shouldCancel?.()) throw new Error("Review cancelled");
      const afterLines = await session.analyze({
        fen: move.fenAfter,
        multipv: 1,
        search,
        shouldCancel: sink.shouldCancel,
        onProgress: (lines, latestDepth) =>
          sink.onPhaseProgress?.({
            moveIndex: index,
            nodeId: move.nodeId,
            san: move.san,
            ply: move.ply,
            fenBefore: move.fenBefore,
            fenAfter: move.fenAfter,
            phase: "after",
            fen: move.fenAfter,
            mover,
            depth: latestDepth,
            lines
          })
      });
      const moveReview = buildMoveReview(move, beforeLines, afterLines);
      moves.push(moveReview);
      sink.onMoveCompleted?.({ moveIndex: index, move: moveReview });
    }

    return {
      engineId: config.id,
      depth: search.recordDepth,
      moveTimeMs: search.recordMoveTimeMs,
      createdAt: Date.now(),
      summary: summarize(moves),
      moves
    };
  } finally {
    session.stop();
  }
}

class UciReviewSession {
  private process: ChildProcessWithoutNullStreams | null = null;
  private events = new EventEmitter<LineEvents>();
  private lineBuffer = "";

  constructor(private config: EngineConfig) { }

  async start(multipv: number): Promise<void> {
    this.process = spawn(this.config.executablePath, spawnArgsForEngine(this.config), {
      cwd: engineProcessCwd(this.config),
      stdio: "pipe"
    });

    this.process.stdout.on("data", (chunk: Buffer) => this.handleStdout(chunk));
    /** Lc0 and others print banners / progress to stderr; that is normal and must not fail the IPC handler. */
    this.process.stderr.on("data", (chunk: Buffer) => {
      const message = chunk.toString("utf8").trim();
      if (message) console.warn("[uci engine review stderr]", message);
    });
    this.process.on("error", (error) => this.events.emit("error", error));
    this.process.on("exit", (code) => {
      if (code !== 0 && this.process) {
        this.events.emit("error", new Error(`Engine exited with code ${code ?? "unknown"}`));
      }
    });

    const uciReady = this.waitFor(
      (line) => line === "uciok",
      120_000,
      "Timed out waiting for uciok (large NN weights can take a while; check --weights for lc0)"
    );
    this.write("uci");
    await uciReady;
    this.write(`setoption name MultiPV value ${multipv}`);
    const engineReady = this.waitFor(
      (line) => line === "readyok",
      25_000,
      "Timed out waiting for readyok"
    );
    this.write("isready");
    await engineReady;
    this.write("ucinewgame");
  }

  async analyze(input: {
    fen: string;
    multipv: number;
    search: ResolvedReviewSearch;
    onProgress?: (lines: AnalysisLine[], depth: number) => void;
    shouldCancel?: () => boolean;
  }): Promise<AnalysisLine[]> {
    const waitBudgetMs = reviewAnalysisTimeoutMs({
      moveTimeMs: input.search.moveTimeMs,
      depth: input.search.depth,
      multipv: input.multipv
    });

    this.write(`setoption name MultiPV value ${input.multipv}`);
    const engineReady = this.waitFor(
      (line) => line === "readyok",
      25_000,
      "Timed out waiting for readyok"
    );
    this.write("isready");
    await engineReady;
    this.write(`position fen ${input.fen}`);

    const latestByPv = new Map<number, EngineInfo>();
    let lastEmittedAt = 0;
    let latestDepth = 0;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        clearInterval(cancelInterval);
        this.events.off("line", onLine);
        this.events.off("error", onError);
      };
      const finish = () => {
        cleanup();
        const finalLines = linesFromInfos(input.fen, latestByPv);
        input.onProgress?.(finalLines, latestDepth);
        resolve(finalLines);
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const emitProgress = () => {
        if (!input.onProgress) return;
        const now = Date.now();
        if (now - lastEmittedAt < 120) return;
        lastEmittedAt = now;
        input.onProgress(linesFromInfos(input.fen, latestByPv), latestDepth);
      };
      const onLine = (line: string) => {
        const info = parseInfoLine(this.config.id, line);
        if (info?.score && info.pv?.length) {
          latestByPv.set(info.multipv ?? 1, info);
          if (info.depth && info.depth > latestDepth) latestDepth = info.depth;
          emitProgress();
        }
        if (parseBestMove(this.config.id, line)) finish();
      };
      const timeout = setTimeout(
        () => {
          cleanup();
          reject(new Error("Timed out waiting for analysis result"));
        },
        waitBudgetMs
      );
      let stopSent = false;
      const cancelInterval = setInterval(() => {
        if (stopSent) return;
        if (input.shouldCancel?.()) {
          stopSent = true;
          this.write("stop");
        }
      }, 100);

      this.events.on("line", onLine);
      this.events.on("error", onError);
      if (input.search.moveTimeMs) this.write(`go movetime ${input.search.moveTimeMs}`);
      else this.write(`go depth ${input.search.depth}`);
    });
  }

  stop(): void {
    if (!this.process) return;
    this.write("quit");
    this.process.kill();
    this.process = null;
  }

  private write(command: string): void {
    this.process?.stdin.write(`${command}\n`);
  }

  private waitFor(
    predicate: (line: string) => boolean,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        this.events.off("line", onLine);
        this.events.off("error", onError);
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
      this.events.on("error", onError);
    });
  }

  private handleStdout(chunk: Buffer): void {
    this.lineBuffer += chunk.toString("utf8");
    const lines = this.lineBuffer.split(/\r?\n/);
    this.lineBuffer = lines.pop() ?? "";
    for (const line of lines.map((item) => item.trim()).filter(Boolean)) {
      this.events.emit("line", line);
    }
  }
}

function linesFromInfos(fen: string, infos: Map<number, EngineInfo>): AnalysisLine[] {
  const turn = statusForFen(fen).turn;
  return [...infos.entries()]
    .sort(([left], [right]) => left - right)
    .map(([multipv, info]) => ({
      multipv,
      depth: info.depth ?? 0,
      score: info.score as EngineScore,
      scoreWhite: scoreFromWhitePerspective(info.score as EngineScore, turn),
      pv: info.pv ?? []
    }));
}

function buildMoveReview(
  move: ReviewMoveInput,
  beforeLines: AnalysisLine[],
  afterLines: AnalysisLine[]
): MoveReview {
  const before = beforeLines[0] ?? null;
  const after = afterLines[0] ?? null;
  const mover = statusForFen(move.fenBefore).turn;
  const evalBefore = before?.scoreWhite ?? null;
  const evalAfter = after?.scoreWhite ?? null;
  const beforeMoverCp = evalBefore ? scoreToCentipawns(evalBefore) * (mover === "white" ? 1 : -1) : null;
  const afterMoverCp = evalAfter ? scoreToCentipawns(evalAfter) * (mover === "white" ? 1 : -1) : null;
  const evalLoss =
    beforeMoverCp === null || afterMoverCp === null
      ? null
      : Math.max(0, Math.min(1000, beforeMoverCp - afterMoverCp));
  const bestMove = before?.pv[0] ?? null;
  const motifs = bestMove ? motifsForBestMove(move.fenBefore, bestMove, before?.scoreWhite ?? null) : [];
  const hasMissedTactic =
    Boolean(bestMove && bestMove !== move.uci) &&
    motifs.length > 0 &&
    (evalLoss ?? 0) >= 150;
  const classification = classifyMove({
    playedMove: move.uci,
    bestMove,
    evalLoss,
    hasMissedTactic
  });

  return {
    nodeId: move.nodeId,
    ply: move.ply,
    san: move.san,
    playedMove: move.uci,
    fenBefore: move.fenBefore,
    fenAfter: move.fenAfter,
    evalBefore,
    evalAfter,
    evalLoss,
    classification,
    bestMove,
    bestLine: before?.pv ?? [],
    topLines: beforeLines,
    motifs,
  };
}

function motifsForBestMove(fen: string, bestMove: string, scoreWhite: EngineScore | null): string[] {
  const motifs: string[] = [];
  const afterFen = fenAfterUci(fen, bestMove);
  if (!afterFen) return motifs;
  const status = statusForFen(afterFen);
  const parsed = moveFromUci(bestMove);
  if (scoreWhite?.type === "mate") motifs.push("forced mate");
  if (status.isCheck) motifs.push(status.isCheckmate ? "checkmate" : "checking move");
  if (parsed && isCapture(fen, bestMove)) motifs.push("capture");
  if (bestMove.length === 5) motifs.push("promotion");
  if (scoreWhite && Math.abs(scoreToCentipawns(scoreWhite)) >= 300) motifs.push("large advantage");
  return [...new Set(motifs)];
}

function isCapture(fen: string, uci: string): boolean {
  const pos = positionFromFen(fen);
  const move = moveFromUci(uci);
  if (!move || !("from" in move) || !("to" in move)) return false;
  if (pos.board.get(move.to)) return true;
  const piece = pos.board.get(move.from);
  return Boolean(piece?.role === "pawn" && pos.epSquare === move.to);
}

function summarize(moves: MoveReview[]): GameReviewSummary {
  let best = 0;
  let excellent = 0;
  let good = 0;
  let inaccuracies = 0;
  let mistakes = 0;
  let blunders = 0;
  let missedTactics = 0;
  let evalLossSum = 0;
  let evalLossCount = 0;

  for (const move of moves) {
    if (move.classification === "best") best += 1;
    else if (move.classification === "excellent") excellent += 1;
    else if (move.classification === "good") good += 1;
    else if (move.classification === "inaccuracy") inaccuracies += 1;
    else if (move.classification === "mistake") mistakes += 1;
    else if (move.classification === "blunder") blunders += 1;
    else if (move.classification === "missed_tactic") missedTactics += 1;

    if (move.evalLoss !== null) {
      evalLossSum += move.evalLoss;
      evalLossCount += 1;
    }
  }

  return {
    totalMoves: moves.length,
    best,
    excellent,
    good,
    inaccuracies,
    mistakes,
    blunders,
    missedTactics,
    averageCentipawnLoss: evalLossCount ? Math.round(evalLossSum / evalLossCount) : null
  };
}
