/**
 * Main's one Insights comparer (comparer.ts), wired to the app: the connected accounts, the
 * repertoire write gate, and the changes that make it compare again — app start, a games sync,
 * import or delete, an account connected or disconnected, and a repertoire edit. Its progress goes
 * out on `repertoireInsights:progress`. Loaded after startup, with what the IPC handlers read
 * (index.ts), out of the main bundle.
 */
import type { GameSource } from "@chaturanga/shared/types/chess";
import { getChesscomService } from "../chesscom";
import { readConnectedUsernames } from "../game-puzzles";
import { broadcast } from "../ipc/broadcast";
import { getLichessService } from "../lichess";
import { progressChanged } from "../repertoire/practice-state";
import { onRepertoireChanged, withRepertoireWriteGate } from "../repertoire/service-runtime";
import { InsightsComparer } from "./comparer";
import { INSIGHTS_SOURCES } from "./games";

export { insightsGamesPage, insightsReport } from "./report";
export { insightsRepository } from "./repository";
export { weakSpotPositions } from "./weak-spots";

/** Changes come in bursts (a sync saves game after game, Study autosaves): one pass after them. */
const SETTLE_MS = 3_000;

let comparer: InsightsComparer | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Compares again once the changes settle. `source`: a saved game's, which changes nothing when
 * Insights doesn't read its games.
 */
export function insightsGamesChanged(source?: GameSource): void {
  if (!comparer || (source !== undefined && !INSIGHTS_SOURCES.includes(source))) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void comparer?.kick();
  }, SETTLE_MS);
}

/** App start: the comparer, its triggers, and a first pass (later calls return it). */
export function startRepertoireInsights(): InsightsComparer {
  if (comparer) return comparer;
  comparer = new InsightsComparer({
    usernames: readConnectedUsernames,
    emit: (status) => broadcast("repertoireInsights:progress", status),
    progressChanged,
    write: (work) => withRepertoireWriteGate(work)
  });
  // A finished sync, and an account connected or disconnected (its games may have gone with it).
  const onAccountEvent = (event: { type: string; running?: boolean }) => {
    if (event.type === "status" || (event.type === "sync" && !event.running))
      insightsGamesChanged();
  };
  getLichessService().on("event", onAccountEvent);
  getChesscomService().on("event", onAccountEvent);
  // Edits bump the revision; practice progress (game misses included) doesn't change what's compared.
  onRepertoireChanged((event) => {
    if (event.kind !== "progress" && event.kind !== "workspace") insightsGamesChanged();
  });
  insightsGamesChanged();
  return comparer;
}

/** Quitting: the pass stops after the chunk being written. */
export async function stopRepertoireInsights(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  await comparer?.stop();
}
