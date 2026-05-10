import { contextBridge, ipcRenderer } from "electron";
import type { ChaturangaApi } from "../shared/ipc/chaturanga-api";

const api: ChaturangaApi = {
  engines: {
    list: () => ipcRenderer.invoke("engines:list"),
    create: (input) => ipcRenderer.invoke("engines:create", input),
    update: (id, patch) => ipcRenderer.invoke("engines:update", id, patch),
    remove: (id) => ipcRenderer.invoke("engines:remove", id),
    test: (idOrInput) => ipcRenderer.invoke("engines:test", idOrInput),
    startGame: (input) => ipcRenderer.invoke("engines:startGame", input),
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
  files: {
    openPgnFile: () => ipcRenderer.invoke("files:openPgnFile"),
    savePgnFile: (defaultName, contents) =>
      ipcRenderer.invoke("files:savePgnFile", defaultName, contents),
    selectExecutable: () => ipcRenderer.invoke("files:selectExecutable")
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
    }
  }
};

contextBridge.exposeInMainWorld("chaturanga", api);
