import type { Maia3Evaluator, Maia3Output, Maia3Query } from "@chaturanga/shared/engine/maia3";

/**
 * An evaluator whose host is closed once nothing has been asked of it for `idleMs` (as the UCI
 * engine is, engine-manager.ts): the host window holds ~600 MB while it's open. The next request
 * opens a new one (a ~4 s load).
 */
export class IdleClosingEvaluator implements Maia3Evaluator {
  private pending = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly inner: Maia3Evaluator,
    private readonly idleMs: number
  ) {}

  isInstalled(): boolean {
    return this.inner.isInstalled();
  }

  evaluate(
    queries: readonly Maia3Query[],
    options?: { priority?: "game" | "review"; signal?: AbortSignal }
  ): Promise<Maia3Output[]> {
    this.clearTimer();
    this.pending += 1;
    const result = this.inner.evaluate(queries, options);
    const settled = () => {
      this.pending -= 1;
      if (this.pending === 0) this.scheduleClose();
    };
    result.then(settled, settled);
    return result;
  }

  dispose(): void {
    this.clearTimer();
    this.inner.dispose();
  }

  private scheduleClose(): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.pending === 0) this.inner.dispose();
    }, this.idleMs);
    this.timer.unref();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
