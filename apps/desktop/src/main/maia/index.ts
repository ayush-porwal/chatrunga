/**
 * Main's one Maia 3 evaluator, shared by engine games (engine-manager.ts) and reviews. Its code
 * (evaluator.ts: the host window's client, or the e2e fixture) loads on the first request, so the
 * main bundle stays without it until Maia is used.
 */
import type { Maia3Evaluator } from "@chaturanga/shared/engine/maia3";
import { MAIA_HOST_SCHEME } from "../../maia-host/protocol";
import { LazyEvaluator } from "./lazy-evaluator";
import type { MaiaHostFiles } from "./maia-host";
import { maia3ModelPath } from "./model-path";

/**
 * The host page's scheme, registered before the app is ready (index.ts): a standard, secure
 * origin, so CSSLab's code gets what a web page has (fetch, workers, IndexedDB, wasm streaming).
 */
export const MAIA_HOST_SCHEME_PRIVILEGES = {
  scheme: MAIA_HOST_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
    corsEnabled: true
  }
};

let hostFiles: MaiaHostFiles | null = null;
let evaluator: Maia3Evaluator | null = null;

/** Where the host's build is (main's index.ts, at startup, before any request). */
export function configureMaia3Host(files: MaiaHostFiles): void {
  hostFiles = files;
}

/** The evaluator (created on first use; nothing is loaded or opened until it is asked something). */
export function getMaia3Evaluator(): Maia3Evaluator {
  evaluator ??= new LazyEvaluator({
    isInstalled: () => maia3ModelPath() !== null,
    load: async () => (await import("./evaluator")).createMaia3Evaluator(hostFiles)
  });
  return evaluator;
}

/** Closes the host window if one is open (main window closed, quit); waiting requests fail. */
export function disposeMaia3Evaluator(): void {
  evaluator?.dispose();
}
