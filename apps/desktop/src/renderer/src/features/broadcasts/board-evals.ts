import { useEffect, useRef } from "react";
import type { EngineScore } from "@chaturanga/shared/types/engine";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { useEnginesQuery, useSettingsQuery } from "../../queries/api";
import { useBroadcastStore } from "../../stores/broadcast-store";
import { analysisEngineFor } from "../analysis/analysis-engine";

/** Positions per engine call (the most `engines.analysePositions` takes). */
const BATCH = 4;
/** Search time per position: a quick look, enough for a bar on a card. */
const EVAL_MS = 300;

/** The next positions to evaluate: wanted, not evaluated yet, in order, a batch at most. */
export function nextEvalBatch(
  wanted: readonly string[],
  evals: Partial<Record<string, EngineScore | null>>
): string[] {
  return [...new Set(wanted)].filter((fen) => !(fen in evals)).slice(0, BATCH);
}

/**
 * Evaluates the boards' positions with a local engine, a few at a time, one search after the
 * other (each in its own engine process: the analysis board's search is never disturbed). Each
 * position is searched once; new ones join as games move on. Stops on an engine failure, saying
 * why.
 */
class BoardEvalQueue {
  private wanted: readonly string[] = [];
  private running = false;
  private stopped = false;
  private requestId: string | null = null;

  constructor(private readonly engineId: string) {}

  want(fens: readonly string[]): void {
    this.wanted = fens;
    void this.run();
  }

  stop(): void {
    this.stopped = true;
    if (this.requestId)
      window.chaturanga?.engines.cancelReview(this.requestId).catch(() => undefined);
  }

  /** Read afresh at each await (stop() may have run meanwhile). */
  private isStopped(): boolean {
    return this.stopped;
  }

  private async run(): Promise<void> {
    const api = window.chaturanga?.engines;
    if (!api || this.running || this.stopped) return;
    this.running = true;
    const store = useBroadcastStore.getState();
    try {
      for (;;) {
        const batch = nextEvalBatch(this.wanted, useBroadcastStore.getState().evals);
        if (!batch.length || this.isStopped()) break;
        this.requestId = crypto.randomUUID();
        const result = await api.analysePositions({
          requestId: this.requestId,
          engineId: this.engineId,
          moveTimeMs: EVAL_MS,
          positions: batch.map((fen) => ({ fen, multipv: 1 }))
        });
        if (this.isStopped()) break;
        store.addEvals(
          batch.map((fen, index) => [fen, result.lines[index]?.[0]?.scoreWhite ?? null])
        );
      }
    } catch (error) {
      if (!this.isStopped()) store.setEvalError(ipcErrorMessage(error));
    } finally {
      this.running = false;
      this.requestId = null;
    }
  }
}

/** Keeps `fens` evaluated with `engineId` while mounted (null: nothing is). */
export function useBoardEvals(fens: readonly string[], engineId: string | null): void {
  const queue = useRef<BoardEvalQueue | null>(null);
  useEffect(() => {
    if (!engineId) return;
    const created = new BoardEvalQueue(engineId);
    queue.current = created;
    return () => {
      created.stop();
      queue.current = null;
    };
  }, [engineId]);
  const key = fens.join("|");
  useEffect(() => {
    queue.current?.want(key ? key.split("|") : []);
  }, [key, engineId]);
}

/**
 * The Boards tab's "Evaluations" switch: off by default (it runs an engine), and off for good
 * without one. The engine is the one Game review uses (settings), else the default.
 */
export function useEvalEngine(): string | null {
  const engines = useEnginesQuery();
  const settings = useSettingsQuery();
  return analysisEngineFor(engines.data, settings.data?.defaultEngineId ?? null);
}
