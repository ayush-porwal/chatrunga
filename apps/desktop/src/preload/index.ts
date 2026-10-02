import { contextBridge, ipcRenderer, webFrame, type IpcRendererEvent } from "electron";
import type { ChaturangaApi, Unsubscribe, WindowGlassState } from "@chaturanga/shared/ipc/chaturanga-api";
import type { RepertoireChangedEvent } from "@chaturanga/shared/types/repertoire";

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

// Closing the window asks for pending saves first (the game autosave, a repertoire chapter draft):
// every registered flush runs, and it's saved only if all of them are. With none, it's done at once.
const flushHandlers = new Set<() => Promise<boolean>>();
ipcRenderer.on("games:flush", (_event, token: string) => {
  void Promise.all([...flushHandlers].map((handler) => handler().catch(() => false))).then((results) =>
    ipcRenderer.send("games:flushed", token, results.every(Boolean))
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
    listPage: (query) => ipcRenderer.invoke("games:listPage", query),
    facets: (excludeId) => ipcRenderer.invoke("games:facets", excludeId),
    get: (id) => ipcRenderer.invoke("games:get", id),
    getReview: (gameId, reviewId) => ipcRenderer.invoke("games:getReview", gameId, reviewId),
    save: (input) => ipcRenderer.invoke("games:save", input),
    remove: (id) => ipcRenderer.invoke("games:remove", id),
    importPgn: (input) => ipcRenderer.invoke("games:importPgn", input),
    onFlushRequest: (handler) => {
      flushHandlers.add(handler);
      return () => {
        flushHandlers.delete(handler);
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
    set: (key, value) => ipcRenderer.invoke("settings:set", key, value),
    patch: (patch) => ipcRenderer.invoke("settings:patch", patch)
  },
  commentary: {
    getOpenRouterConfig: () => ipcRenderer.invoke("commentary:getOpenRouterConfig"),
    setOpenRouterConfig: (input) => ipcRenderer.invoke("commentary:setOpenRouterConfig", input),
    generate: (input) => ipcRenderer.invoke("commentary:generate", input)
  },
  telemetry: {
    status: () => ipcRenderer.invoke("telemetry:status"),
    track: (event) => ipcRenderer.invoke("telemetry:track", event)
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
  // Repertoires (main/repertoire): study, decisions, import/export and graded practice.
  repertoires: {
    list: (filters) => ipcRenderer.invoke("repertoires:list", filters),
    get: (id) => ipcRenderer.invoke("repertoires:get", id),
    getChapter: (input) => ipcRenderer.invoke("repertoires:getChapter", input),
    getDecision: (input) => ipcRenderer.invoke("repertoires:getDecision", input),
    create: (input) => ipcRenderer.invoke("repertoires:create", input),
    updateMetadata: (input) => ipcRenderer.invoke("repertoires:updateMetadata", input),
    saveChapter: (input) => ipcRenderer.invoke("repertoires:saveChapter", input),
    updateDecision: (input) => ipcRenderer.invoke("repertoires:updateDecision", input),
    removeChapter: (input) => ipcRenderer.invoke("repertoires:removeChapter", input),
    duplicate: (input) => ipcRenderer.invoke("repertoires:duplicate", input),
    archive: (input) => ipcRenderer.invoke("repertoires:archive", input),
    remove: (input) => ipcRenderer.invoke("repertoires:remove", input),
    previewImport: (input) => ipcRenderer.invoke("repertoires:previewImport", input),
    commitImport: (input) => ipcRenderer.invoke("repertoires:commitImport", input),
    cancelImport: (jobId) => ipcRenderer.invoke("repertoires:cancelImport", jobId),
    export: (input) => ipcRenderer.invoke("repertoires:export", input),
    startPractice: (input) => ipcRenderer.invoke("repertoires:startPractice", input),
    resumePractice: (sessionId) => ipcRenderer.invoke("repertoires:resumePractice", sessionId),
    recordPracticeAction: (input) => ipcRenderer.invoke("repertoires:recordPracticeAction", input),
    recordAttempt: (input) => ipcRenderer.invoke("repertoires:recordAttempt", input),
    endPractice: (sessionId) => ipcRenderer.invoke("repertoires:endPractice", sessionId),
    saveWorkspace: (input) => ipcRenderer.invoke("repertoires:saveWorkspace", input),
    getDueSummary: () => ipcRenderer.invoke("repertoires:getDueSummary"),
    onChanged: subscribe<RepertoireChangedEvent>("repertoires:changed")
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
