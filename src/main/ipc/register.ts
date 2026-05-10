import { dialog, ipcMain } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import type { AppSettings } from "../../shared/types/settings";
import type { CreateEngineInput } from "../../shared/types/engine";
import { importPgnText } from "../../shared/chess/pgn";
import { engineRepository, gameRepository, settingsRepository } from "../db/repositories";
import type { EngineManager } from "../engine/engine-manager";

export function registerIpc(engineManager: EngineManager): void {
  ipcMain.handle("engines:list", () => engineRepository.list());
  ipcMain.handle("engines:create", (_event, input) => engineRepository.create(assertEngineInput(input)));
  ipcMain.handle("engines:update", (_event, id: string, patch) =>
    engineRepository.update(String(id), patch)
  );
  ipcMain.handle("engines:remove", (_event, id: string) => engineRepository.remove(String(id)));
  ipcMain.handle("engines:test", async (_event, idOrInput: string | CreateEngineInput) => {
    if (typeof idOrInput === "string") return engineManager.testEngine(idOrInput);
    const config = {
      id: "test",
      protocol: "uci" as const,
      isDefault: false,
      isEnabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...assertEngineInput(idOrInput),
      args: idOrInput.args ?? [],
      workingDirectory: idOrInput.workingDirectory ?? null
    };
    return engineManager.testEngine(config);
  });
  ipcMain.handle("engines:startGame", (_event, input) => engineManager.start(input));
  ipcMain.handle("engines:stop", () => engineManager.stop());

  ipcMain.handle("games:list", () => gameRepository.list());
  ipcMain.handle("games:get", (_event, id: string) => {
    const game = gameRepository.get(String(id));
    if (!game) throw new Error("Game not found");
    return game;
  });
  ipcMain.handle("games:save", (_event, input) => gameRepository.save(input));
  ipcMain.handle("games:remove", (_event, id: string) => gameRepository.remove(String(id)));
  ipcMain.handle("games:importPgn", (_event, input: { pgn: string }) => importPgnText(input.pgn));
  ipcMain.handle("games:exportPgn", (_event, id: string) => {
    const game = gameRepository.get(String(id));
    if (!game) throw new Error("Game not found");
    return game.pgn;
  });

  ipcMain.handle("files:openPgnFile", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "PGN files", extensions: ["pgn"] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return {
      path: result.filePaths[0],
      contents: await readFile(result.filePaths[0], "utf8")
    };
  });

  ipcMain.handle("files:savePgnFile", async (_event, defaultName: string, contents: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: "PGN files", extensions: ["pgn"] }]
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, contents, "utf8");
    return result.filePath;
  });

  ipcMain.handle("files:selectExecutable", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Executables", extensions: ["exe", "bin", "app", "*"] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("settings:getAll", () => settingsRepository.getAll());
  ipcMain.handle("settings:set", (_event, key: keyof AppSettings, value: unknown) =>
    settingsRepository.set(key, value)
  );
}

function assertEngineInput(input: CreateEngineInput): CreateEngineInput {
  if (!input || typeof input !== "object") throw new Error("Invalid engine input");
  if (!input.executablePath?.trim()) throw new Error("Engine executable path is required");
  return {
    ...input,
    name: input.name?.trim() || "UCI Engine",
    executablePath: input.executablePath.trim(),
    args: input.args ?? []
  };
}
