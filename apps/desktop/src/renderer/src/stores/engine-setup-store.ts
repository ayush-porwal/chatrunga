import { create } from "zustand";
import type {
  AssetProgressEvent,
  EngineAssetId,
  EngineAssetStatus
} from "@chaturanga/shared/ipc/chaturanga-api";
import {
  applyAssetProgress,
  initialAssetProgress,
  type AssetProgressMap
} from "@/lib/engine-assets";

/** How many assets download at once (the main process's downloadAll uses the same). */
const CONCURRENCY = 3;

type EngineSetupStore = {
  /** The assets the first-run setup asked for, in display order (kept after they finish). */
  queued: EngineAssetStatus[];
  progress: AssetProgressMap;
  /** Assets whose download is in flight. */
  active: EngineAssetId[];
  /** Downloads the given assets (skipping any already queued and in flight). */
  start: (assets: readonly EngineAssetStatus[]) => Promise<void>;
  /** Downloads failed assets again. */
  retry: (ids: readonly EngineAssetId[]) => Promise<void>;
  applyEvent: (event: AssetProgressEvent) => void;
};

/**
 * The first-run engine downloads (Stockfish + Maia), shared by the welcome, Home and Game review
 * so progress survives leaving the welcome: the downloads run in the main process and keep going
 * in the background whatever the renderer shows. Each asset is its own `assets.download`, so
 * Stockfish becomes usable the moment it is installed (main syncs the engine list after each one)
 * instead of after the whole batch.
 */
export const useEngineSetupStore = create<EngineSetupStore>((set, get) => {
  const run = async (ids: EngineAssetId[]) => {
    const queue = [...ids];
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        const assetId = id;
        set((state) => ({ active: [...state.active, assetId] }));
        let failure: string | null = null;
        try {
          const result = await window.chaturanga?.assets.download(assetId);
          if (result && !result.ok) failure = result.error;
        } catch (error) {
          failure = error instanceof Error ? error.message : String(error);
        }
        set((state) => ({
          active: state.active.filter((item) => item !== assetId),
          // The result is the source of truth (a progress event can be missed between subscriptions).
          progress: applyAssetProgress(
            state.progress,
            failure ? { type: "error", assetId, message: failure } : { type: "ready", assetId }
          )
        }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
  };

  return {
    queued: [],
    progress: {},
    active: [],
    start: async (assets) => {
      ensureProgressSubscription();
      const { queued, active } = get();
      const fresh = assets.filter((asset) => !active.includes(asset.id));
      if (!fresh.length) return;
      const known = new Set(queued.map((asset) => asset.id));
      set((state) => ({
        queued: [...state.queued, ...fresh.filter((asset) => !known.has(asset.id))],
        progress: { ...state.progress, ...initialAssetProgress(fresh) }
      }));
      await run(fresh.map((asset) => asset.id));
    },
    retry: async (ids) => {
      const assets = get().queued.filter((asset) => ids.includes(asset.id));
      await get().start(assets);
    },
    applyEvent: (event) => {
      if (!get().queued.some((asset) => asset.id === event.assetId)) return;
      set((state) => ({ progress: applyAssetProgress(state.progress, event) }));
    }
  };
});

let unsubscribe: (() => void) | null = null;

/** One app-wide listener for asset progress, attached the first time setup starts. */
function ensureProgressSubscription(): void {
  if (unsubscribe || !window.chaturanga) return;
  unsubscribe = window.chaturanga.onAssetProgress((event) =>
    useEngineSetupStore.getState().applyEvent(event)
  );
}

/** True while any first-run download is in flight. */
export const selectSetupRunning = (state: EngineSetupStore) => state.active.length > 0;
