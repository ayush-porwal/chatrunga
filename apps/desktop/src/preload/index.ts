import { contextBridge, ipcRenderer } from "electron";
import type { ChaturangaApi } from "@chaturanga/shared/ipc/chaturanga-api";

const probeEvalChannel = "engines:probeEval";

const api: ChaturangaApi = {
  environment: {
    isElectron: true,
    platform: process.platform
  },
  enginesProbeEval: (input) => ipcRenderer.invoke(probeEvalChannel, input),
  engines: {
    list: () => ipcRenderer.invoke("engines:list"),
    create: (input) => ipcRenderer.invoke("engines:create", input),
    update: (id, patch) => ipcRenderer.invoke("engines:update", id, patch),
    remove: (id) => ipcRenderer.invoke("engines:remove", id),
    test: (idOrInput) => ipcRenderer.invoke("engines:test", idOrInput),
    startGame: (input) => ipcRenderer.invoke("engines:startGame", input),
    startAnalysis: (input) => ipcRenderer.invoke("engines:startAnalysis", input),
    probeEval: (input) => ipcRenderer.invoke(probeEvalChannel, input),
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
    exportPgn: (gameId) => ipcRenderer.invoke("games:exportPgn", gameId)
  },
  databases: {
    list: () => ipcRenderer.invoke("databases:list"),
    download: (sourceId) => ipcRenderer.invoke("databases:download", sourceId),
    samplePuzzle: (input) => ipcRenderer.invoke("databases:samplePuzzle", input),
    remove: (id) => ipcRenderer.invoke("databases:remove", id)
  },
  files: {
    openPgnFile: () => ipcRenderer.invoke("files:openPgnFile"),
    savePgnFile: (defaultName, contents) =>
      ipcRenderer.invoke("files:savePgnFile", defaultName, contents),
    selectExecutable: () => ipcRenderer.invoke("files:selectExecutable"),
    selectOpenFile: (filters) => ipcRenderer.invoke("files:selectOpenFile", filters)
  },
  settings: {
    getAll: () => ipcRenderer.invoke("settings:getAll"),
    set: (key, value) => ipcRenderer.invoke("settings:set", key, value)
  },
  events: {
    onEngineInfo: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, info: unknown) => callback(info as never);
      ipcRenderer.on("engine:info", listener);
      return () => ipcRenderer.off("engine:info", listener);
    },
    onEngineBestMove: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, move: unknown) => callback(move as never);
      ipcRenderer.on("engine:bestmove", listener);
      return () => ipcRenderer.off("engine:bestmove", listener);
    },
    onEngineError: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, error: unknown) => callback(error as never);
      ipcRenderer.on("engine:error", listener);
      return () => ipcRenderer.off("engine:error", listener);
    },
    onReviewProgress: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: unknown) =>
        callback(progress as never);
      ipcRenderer.on("review:progress", listener);
      return () => ipcRenderer.off("review:progress", listener);
    },
    onReviewMoveCompleted: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) =>
        callback(payload as never);
      ipcRenderer.on("review:moveCompleted", listener);
      return () => ipcRenderer.off("review:moveCompleted", listener);
    },
    onReviewCompleted: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) =>
        callback(payload as never);
      ipcRenderer.on("review:completed", listener);
      return () => ipcRenderer.off("review:completed", listener);
    },
    onReviewFailed: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) =>
        callback(payload as never);
      ipcRenderer.on("review:failed", listener);
      return () => ipcRenderer.off("review:failed", listener);
    },
    onDatabaseDownloadProgress: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) =>
        callback(payload as never);
      ipcRenderer.on("database:downloadProgress", listener);
      return () => ipcRenderer.off("database:downloadProgress", listener);
    }
  }
};

contextBridge.exposeInMainWorld("chaturanga", api);
