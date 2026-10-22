import {
  Maia3UnavailableError,
  type Maia3Evaluator,
  type Maia3Output,
  type Maia3Query
} from "@chaturanga/shared/engine/maia3";

/**
 * An evaluator whose code is loaded on its first request (`load`, a dynamic import), so the main
 * bundle doesn't carry Maia's host client until Maia is used. A load that fails is tried again on
 * the next request. `isInstalled` answers without loading anything.
 *
 * `dispose` never makes it unusable: the app asks again after it (the main window is recreated on
 * macOS `activate`, the model is replaced). A loaded evaluator is disposed and reopens its host on
 * the next request; a load still running is dropped, and when it resolves its evaluator is
 * disposed at once and the requests waiting on it fail, so nothing opens after the dispose. The
 * next request loads again.
 */
export class LazyEvaluator implements Maia3Evaluator {
  private loading: Promise<Maia3Evaluator> | null = null;
  private loaded: Maia3Evaluator | null = null;
  /** Counts disposes: a load started before the latest one is stale. */
  private generation = 0;

  constructor(
    private readonly options: {
      load: () => Promise<Maia3Evaluator>;
      isInstalled: () => boolean;
    }
  ) {}

  isInstalled(): boolean {
    return this.options.isInstalled();
  }

  evaluate(
    queries: readonly Maia3Query[],
    options?: { priority?: "game" | "review"; signal?: AbortSignal }
  ): Promise<Maia3Output[]> {
    this.loading ??= this.load();
    return this.loading.then((evaluator) => evaluator.evaluate(queries, options));
  }

  /** Disposes the loaded evaluator, or the one still loading once it is there (see above). */
  dispose(): void {
    this.generation += 1;
    if (this.loaded) this.loaded.dispose();
    else this.loading = null;
  }

  private load(): Promise<Maia3Evaluator> {
    const generation = this.generation;
    return this.options.load().then(
      (evaluator) => {
        if (generation !== this.generation) {
          evaluator.dispose();
          throw new Maia3UnavailableError("Maia was closed while it loaded.");
        }
        return (this.loaded = evaluator);
      },
      (error: unknown) => {
        if (generation === this.generation) this.loading = null;
        throw error;
      }
    );
  }
}
