import { contextBridge, ipcRenderer, webFrame, type IpcRendererEvent } from "electron";
import type { ChaturangaApi, Unsubscribe, WindowGlassState } from "@chaturanga/shared/ipc/chaturanga-api";

// Runs sandboxed: only `electron`'s renderer modules are available here, no Node APIs.

/** Subscribes to a main → renderer event channel; returns the unsubscribe function. */
function subscribe<T>(channel: string) {
  return (callback: (payload: T) => void): Unsubscribe => {
    const listener = (_event: IpcRendererEvent, payload: T) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.off(channel, listener);
  };
}

type EventPayload<K extends keyof ChaturangaApi["events"]> = Parameters<Parameters<ChaturangaApi["events"][K]>[0]>[0];

// Read once, synchronously, so the renderer's first frame matches the native window (vibrancy or
// opaque); kept current by the change events below.
let glassState = ipcRenderer.sendSync("appearance:getGlassSync") as WindowGlassState;
const onGlassChanged = subscribe<WindowGlassState>("appearance:glassChanged");
onGlassChanged((state) => {
  glassState = state;
});

// Closing the window asks for pending saves first; with no flush registered, it's done at once.
let flushHandler: (() => Promise<boolean>) | null = null;
ipcRenderer.on("games:flush", (_event, token: string) => {
  const handler = flushHandler;
  void (handler ? handler().catch(() => false) : Promise.resolve(true)).then((saved) =>
    ipcRenderer.send("games:flushed", token, saved)
  );
});

const api: ChaturangaApi = {
  environment: {
    isElectron: true,
    platform: process.platform
  },
  system: {
    timeAsleepMs: () => Number(ipcRenderer.sendSync("system:timeAsleepMs")) || 0,
    onResumed: subscribe<void>("system:resumed")
  },
  appearance: {
    getGlass: () => glassState,
    getZoomFactor: () => webFrame.getZoomFactor(),
    onGlassChanged,
    rendererReady: () => ipcRenderer.send("appearance:rendererReady")
  },
  engines: {
    list: () => ipcRenderer.invoke("engines:list"),
    create: (input) => ipcRenderer.invoke("engines:create", input),
    update: (id, patch) => ipcRenderer.invoke("engines:update", id, patch),
    remove: (id) => ipcRenderer.invoke("engines:remove", id),
    test: (idOrInput) => ipcRenderer.invoke("engines:test", idOrInput),
    startGame: (input) => ipcRenderer.invoke("engines:startGame", input),
    startAnalysis: (input) => ipcRenderer.invoke("engines:startAnalysis", input),
    probeEval: (input) => ipcRenderer.invoke("engines:probeEval", input),
    reviewGame: (input) => ipcRenderer.invoke("engines:reviewGame", input),
    cancelReview: (reviewId) => ipcRenderer.invoke("engines:cancelReview", reviewId),
    stop: () => ipcRenderer.invoke("engines:stop")
  },
  games: {
    list: () => ipcRenderer.invoke("games:list"),
    get: (id) => ipcRenderer.invoke("games:get", id),
    save: (input) => ipcRenderer.invoke("games:save", input),
    remove: (id) => ipcRenderer.invoke("games:remove", id),
    importPgn: (input) => ipcRenderer.invoke("games:importPgn", input),
    onFlushRequest: (handler) => {
      flushHandler = handler;
      return () => {
        if (flushHandler === handler) flushHandler = null;
      };
    }
  },
  databases: {
    list: () => ipcRenderer.invoke("databases:list"),
    download: (sourceId) => ipcRenderer.invoke("databases:download", sourceId),
    samplePuzzle: (input) => ipcRenderer.invoke("databases:samplePuzzle", input),
    remove: (id) => ipcRenderer.invoke("databases:remove", id),
    cancelDownload: (sourceId) => ipcRenderer.invoke("databases:cancelDownload", sourceId),
    activeDownloads: () => ipcRenderer.invoke("databases:activeDownloads")
  },
  files: {
    openPgnFile: () => ipcRenderer.invoke("files:openPgnFile"),
    savePgnFile: (defaultName, contents) => ipcRenderer.invoke("files:savePgnFile", defaultName, contents),
    selectExecutable: () => ipcRenderer.invoke("files:selectExecutable"),
    selectOpenFile: (filters) => ipcRenderer.invoke("files:selectOpenFile", filters)
  },
  settings: {
    getAll: () => ipcRenderer.invoke("settings:getAll"),
    set: (key, value) => ipcRenderer.invoke("settings:set", key, value)
  },
  commentary: {
    getOpenRouterConfig: () => ipcRenderer.invoke("commentary:getOpenRouterConfig"),
    setOpenRouterConfig: (input) => ipcRenderer.invoke("commentary:setOpenRouterConfig", input),
    generate: (input) => ipcRenderer.invoke("commentary:generate", input)
  },
  events: {
    onEngineInfo: subscribe<EventPayload<"onEngineInfo">>("engine:info"),
    onEngineBestMove: subscribe<EventPayload<"onEngineBestMove">>("engine:bestmove"),
    onEngineError: subscribe<EventPayload<"onEngineError">>("engine:error"),
    onReviewProgress: subscribe<EventPayload<"onReviewProgress">>("review:progress"),
    onReviewMoveCompleted: subscribe<EventPayload<"onReviewMoveCompleted">>("review:moveCompleted"),
    onReviewCompleted: subscribe<EventPayload<"onReviewCompleted">>("review:completed"),
    onReviewFailed: subscribe<EventPayload<"onReviewFailed">>("review:failed"),
    onDatabaseDownloadProgress: subscribe<EventPayload<"onDatabaseDownloadProgress">>("database:downloadProgress"),
    onUpdateState: subscribe<EventPayload<"onUpdateState">>("updates:state"),
    onLichessEvent: subscribe<EventPayload<"onLichessEvent">>("lichess:event"),

  },
  // Lichess account, play and import (main/lichess).
  lichess: {
    status: () => ipcRenderer.invoke("lichess:status"),
    connect: () => ipcRenderer.invoke("lichess:connect"),
    cancelConnect: () => ipcRenderer.invoke("lichess:cancelConnect"),
    disconnect: (options) => ipcRenderer.invoke("lichess:disconnect", options),
    syncGames: () => ipcRenderer.invoke("lichess:syncGames"),
    seek: (input) => ipcRenderer.invoke("lichess:seek", input),
    cancelSeek: () => ipcRenderer.invoke("lichess:cancelSeek"),
    challenge: (input) => ipcRenderer.invoke("lichess:challenge", input),
    challengeAi: (input) => ipcRenderer.invoke("lichess:challengeAi", input),
    acceptChallenge: (challengeId) => ipcRenderer.invoke("lichess:acceptChallenge", challengeId),
    declineChallenge: (challengeId) => ipcRenderer.invoke("lichess:declineChallenge", challengeId),
    cancelChallenge: (challengeId) => ipcRenderer.invoke("lichess:cancelChallenge", challengeId),
    challenges: () => ipcRenderer.invoke("lichess:challenges"),
    ongoingGames: () => ipcRenderer.invoke("lichess:ongoingGames"),
    watchGame: (gameId) => ipcRenderer.invoke("lichess:watchGame", gameId),
    unwatchGame: (gameId) => ipcRenderer.invoke("lichess:unwatchGame", gameId),
    move: (gameId, uci) => ipcRenderer.invoke("lichess:move", gameId, uci),
    resign: (gameId) => ipcRenderer.invoke("lichess:resign", gameId),
    abort: (gameId) => ipcRenderer.invoke("lichess:abort", gameId),
    offerDraw: (gameId) => ipcRenderer.invoke("lichess:offerDraw", gameId),
    declineDraw: (gameId) => ipcRenderer.invoke("lichess:declineDraw", gameId)
  },
  updates: {
    getState: () => ipcRenderer.invoke("updates:getState"),
    check: () => ipcRenderer.invoke("updates:check"),
    download: () => ipcRenderer.invoke("updates:download"),
    install: () => ipcRenderer.invoke("updates:install"),
    openDownload: () => ipcRenderer.invoke("updates:openDownload")
  },
  // Engine + Maia weight downloads (main/engine/asset-manager.ts).
  assets: {
    download: (assetId) => ipcRenderer.invoke("assets:download", assetId),
    downloadAll: () => ipcRenderer.invoke("assets:downloadAll"),
    remove: (assetId) => ipcRenderer.invoke("assets:remove", assetId),
    setCustomPath: (assetId, customPath) => ipcRenderer.invoke("assets:setCustomPath", assetId, customPath),
    status: (options) => ipcRenderer.invoke("assets:status", options),
    checkForUpdates: () => ipcRenderer.invoke("assets:checkForUpdates"),
    update: (assetId) => ipcRenderer.invoke("assets:update", assetId)
  },
  onAssetProgress: subscribe("assets:progress"),
  onAssetStatusChanged: subscribe<void>("assets:statusChanged"),
  onEnginesChanged: subscribe<void>("engines:changed")
};

contextBridge.exposeInMainWorld("chaturanga", api);
