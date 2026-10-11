/**
 * What the repertoire service tests' module mocks stand on: userData, the windows' sent events,
 * the save dialog, and import parses held until a test lets them settle. Tests load it in
 * `vi.hoisted` (their `vi.mock` factories use it), so it imports no mocked module.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import type * as ImportRunner from "../import-runner";

export const userData = mkdtempSync(join(tmpdir(), "chaturanga-repertoire-test-"));
/** Events broadcast to the renderer, in order. */
export const sent: { channel: string; payload: unknown }[] = [];
export const showSaveDialog = vi.fn(async (...args: unknown[]) => {
  void args;
  return { canceled: true, filePath: undefined as string | undefined };
});

export const electronModule = {
  app: { getPath: () => userData },
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          isDestroyed: () => false,
          send: (channel: string, payload: unknown) => sent.push({ channel, payload })
        }
      }
    ],
    getFocusedWindow: () => null
  },
  dialog: { showSaveDialog: (...args: unknown[]) => showSaveDialog(...args) }
};

/**
 * Parses the next previews start are held here instead of running, while `hold` is set: each
 * settles only when the test resolves it, so a test can keep imports "running" for as long as it
 * needs without parsing a large input against the clock.
 */
export const heldParses = {
  hold: false,
  runs: [] as { resolve: () => void; cancelled: boolean }[]
};

export function withHeldParses(
  actual: typeof ImportRunner,
  ImportCancelledError: new () => Error
): typeof ImportRunner {
  return {
    ...actual,
    startImportParse: (...args: Parameters<typeof actual.startImportParse>) => {
      if (!heldParses.hold) return actual.startImportParse(...args);
      let settle!: (outcome: Error | null) => void;
      const result = new Promise<{ games: [] }>((resolve, reject) => {
        settle = (error) => (error ? reject(error) : resolve({ games: [] }));
      });
      const run = { resolve: () => settle(null), cancelled: false };
      heldParses.runs.push(run);
      return {
        result,
        cancel: () => {
          run.cancelled = true;
          settle(new ImportCancelledError());
        }
      };
    }
  };
}
