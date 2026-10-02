import { BrowserWindow, dialog, ipcMain, powerMonitor, type IpcMainInvokeEvent } from "electron";
import type { AppSettings } from "@chaturanga/shared/types/settings";
import { allowChosenFile } from "../image-access";
import { parseSettingValue } from "./settings-values";
import type { EventEmitter } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import { SAVE_SUPPRESSED_AFTER_DELETE } from "@chaturanga/shared/ipc/game-handling";
import type {
  EngineAssetActionResult,
  EngineAssetDownloadSummary,
  EngineAssetStatusMap
} from "@chaturanga/shared/ipc/chaturanga-api";
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import type { ImportedGame } from "@chaturanga/shared/types/chess";
import { engineRepository, gameRepository, settingsRepository } from "../db/repositories";
import {
  activeDownloads,
  cancelDownload,
  downloadDatabase,
  listInstalledDatabases,
  removeDatabase,
  samplePuzzle
} from "../databases/external-databases";
import { engineConfigForId, listAllEngines } from "../engine/engine-config";
import type { EngineEvents, EngineManager } from "../engine/engine-manager";
import { probeEvalScore } from "../engine/probe-eval";
import { ALL_ASSET_IDS, getAssetManager, isAssetId, type AssetId } from "../engine/asset-manager";
import { syncAssetsToEngineRegistry } from "../engine/engine-registry-sync";
import { gameFingerprint, lichessGameId } from "../db/game-fingerprint";
import { detectLc0 } from "../engine/lc0-detect";
import { getOpenRouterConfigStore } from "../commentary/openrouter-config";
import {
  UNREADABLE_API_KEY_ERROR,
  generateOpenRouterCommentary,
  parseCommentaryPayloads,
  reportUnsent
} from "../commentary/openrouter-commentary";
import { getLichessService } from "../lichess";
import { errorMessage, logger } from "../logger";
import { updateService } from "../updater";
import { runGameReview } from "./review-handler";
import { missedBetween, readClocks, type ClockReading } from "../time-asleep";
import { parseCommentaryRequestContext } from "@chaturanga/shared/schemas/telemetry";
import { getTelemetry } from "../telemetry";
import { commentaryReporter } from "../telemetry/commentary";
import { usageAnalyticsConsent } from "../telemetry/config";
import { noteEngineReadiness } from "../telemetry/engine-readiness";
import { parseRendererEvent, recordRendererEvent } from "../telemetry/renderer-events";
import {
  asAbsolutePath,
  asId,
  asLichessId,
  asLichessUci,
  asObject,
  asString,
  parseDefaultFileName,
  parseDialogFilters,
  parseEngineInput,
  parseEnginePatch,
  parseLichessAiChallengeInput,
  parseLichessChallengeInput,
  parseLichessDisconnectInput,
  parseLichessSeekInput,
  parsePgnText,
  parseProbeEvalInput,
  parsePuzzleSampleInput,
  parseReviewGameInput,
  parseSaveGameInput,
  parseSettingKey,
  parseSettingsPatch,
  parseStartAnalysisInput,
  parseStartGameInput
} from "./validate";

/** Sends to every live window (a closed window's webContents must not be used). */
function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(channel, payload);
  }
}

const ENGINE_EVENT_CHANNELS: Record<keyof EngineEvents, string> = {
  info: "engine:info",
  bestmove: "engine:bestmove",
  error: "engine:error",
  reviewProgress: "review:progress",
  reviewMoveCompleted: "review:moveCompleted",
  reviewCompleted: "review:completed",
  reviewFailed: "review:failed"
};

/** Native dialogs are parented to the calling window so they attach as sheets on macOS. */
function showOpenDialog(event: IpcMainInvokeEvent, options: Electron.OpenDialogOptions) {
  const owner = BrowserWindow.fromWebContents(event.sender);
  return owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options);
}

function showSaveDialog(event: IpcMainInvokeEvent, options: Electron.SaveDialogOptions) {
  const owner = BrowserWindow.fromWebContents(event.sender);
  return owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options);
}

/**
 * Autosave is debounced in the renderer, so a save can arrive just after the
 * game was deleted; the SQLite upsert would resurrect it. Deleted ids are
 * remembered for a while and such saves rejected.
 */
const recentlyDeletedGames = new Map<string, number>();
const DELETE_GUARD_MS = 120_000;

function wasRecentlyDeleted(gameId: string): boolean {
  const now = Date.now();
  for (const [id, deletedAt] of recentlyDeletedGames) {
    if (now - deletedAt > DELETE_GUARD_MS) recentlyDeletedGames.delete(id);
  }
  return recentlyDeletedGames.has(gameId);
}

function testConfigFor(value: unknown): EngineConfig | string {
  if (typeof value === "string") return asId(value, "engine id");
  const input = parseEngineInput(value);
  const now = Date.now();
  return {
    id: "test",
    name: input.name,
    executablePath: input.executablePath,
    workingDirectory: input.workingDirectory ?? null,
    weightsPath: input.weightsPath ?? null,
    imagePath: input.imagePath ?? null,
    args: input.args ?? [],
    protocol: "uci",
    runtime: "custom-uci",
    isAvailable: true,
    isDefault: false,
    createdAt: now,
    updatedAt: now
  };
}

export function registerIpc(engineManager: EngineManager): void {
  for (const [event, channel] of Object.entries(ENGINE_EVENT_CHANNELS)) {
    (engineManager as EventEmitter).on(event, (payload: unknown) => broadcast(channel, payload));
  }
  registerEngineIpc(engineManager);
  registerAssetIpc();
  registerLibraryIpc();
  registerCommentaryIpc();
  registerUpdateIpc();
  registerLichessIpc();
  registerTelemetryIpc();
  // Match clocks run on the renderer's monotonic clock, which may stop while the computer sleeps.
  // Main keeps the total it missed; the renderer reads it synchronously whenever it checks a clock,
  // so a move handled right after waking already sees it (an event could arrive too late).
  let timeAsleepMs = 0;
  let suspendedAt: ClockReading | null = null;
  const missedSince = (at: ClockReading) => missedBetween(at, readClocks());
  powerMonitor.on("suspend", () => {
    suspendedAt = readClocks();
  });
  powerMonitor.on("resume", () => {
    if (suspendedAt) timeAsleepMs += missedSince(suspendedAt);
    suspendedAt = null;
    // Even a short sleep (the renderer's drift check may not notice it): read the total again.
    broadcast("system:resumed", undefined);
  });
  // Also counts a wake main hasn't handled yet (its resume event can come after the renderer's input).
  ipcMain.on("system:timeAsleepMs", (event) => {
    event.returnValue = timeAsleepMs + (suspendedAt ? missedSince(suspendedAt) : 0);
  });
}

function registerEngineIpc(engineManager: EngineManager): void {
  ipcMain.handle("engines:list", () => listAllEngines());
  ipcMain.handle("engines:create", (_event, input: unknown) => {
    const engine = engineRepository.create(parseEngineInput(input));
    noteEngineReadiness(false);
    return engine;
  });
  ipcMain.handle("engines:update", (_event, id: unknown, patch: unknown) => {
    const engine = engineRepository.update(asId(id, "engine id"), parseEnginePatch(patch));
    noteEngineReadiness(false);
    return engine;
  });
  ipcMain.handle("engines:remove", (_event, id: unknown) => engineRepository.remove(asId(id, "engine id")));
  ipcMain.handle("engines:test", (_event, idOrInput: unknown) => engineManager.testEngine(testConfigFor(idOrInput)));
  ipcMain.handle("engines:startGame", (_event, input: unknown) => engineManager.start(parseStartGameInput(input)));
  ipcMain.handle("engines:startAnalysis", (_event, input: unknown) =>
    engineManager.startAnalysis(parseStartAnalysisInput(input))
  );
  ipcMain.handle("engines:probeEval", (_event, value: unknown) => {
    const input = parseProbeEvalInput(value);
    const config = engineConfigForId(input.engineId);
    if (!config) throw new Error("Engine not found");
    // The warm process (lc0's network) has exited first, and no search starts one during the probe.
    return engineManager.runExclusive(() => probeEvalScore(config, input.fen, input.moves, input.movetimeMs));
  });
  ipcMain.handle("engines:reviewGame", (_event, input: unknown) =>
    runGameReview(engineManager, parseReviewGameInput(input))
  );
  ipcMain.handle("engines:cancelReview", (_event, reviewId: unknown) =>
    engineManager.cancelReview(asId(reviewId, "review id"))
  );
  ipcMain.handle("engines:stop", () => engineManager.stop());
}

/**
 * Lc0 has no download on macOS or Linux, so Maia (which runs inside Lc0) only works once the user
 * points the app at their own Lc0. One they installed in the usual place (e.g. Homebrew) is
 * picked up at startup instead. Never replaces a path the user chose, never comes back after they
 * forgot it (until they choose one again), and never fails startup.
 */
async function adoptInstalledLc0(assetManager: ReturnType<typeof getAssetManager>): Promise<void> {
  try {
    if (settingsRepository.getStored("lc0AutoDetect") === false) return;
    const current = assetManager.getInstalled().lc0;
    if (current && current.state !== "missing") return;
    const found = await detectLc0();
    if (!found) return;
    await assetManager.setCustomPath("lc0", found);
    logger.info("asset-manager", `using the Lc0 found at ${found}`);
  } catch (error) {
    logger.warn("asset-manager", "looking for an installed Lc0 failed:", errorMessage(error));
  }
}

/** Engine binary + Maia weight downloads, mirrored into the engines table. */
function registerAssetIpc(): void {
  const assetManager = getAssetManager();
  const parseAssetId = (value: unknown): AssetId => {
    if (!isAssetId(value)) throw new Error("Invalid asset id");
    return value;
  };
  // Keep the engines table in step with what the asset manager installed, so
  // review / play can spawn it. Failures are logged; the asset state stands.
  // After every sync the renderer re-fetches its cached engine list (e.g. engines installed
  // from the welcome dialog become usable for review/analysis right away).
  const syncEngines = () =>
    syncAssetsToEngineRegistry()
      .then(() => {
        broadcast("engines:changed", undefined);
        noteEngineReadiness(false);
      })
      .catch((error) => logger.error("asset-manager", "engine registry sync failed:", error));

  assetManager.on("progress", (event) => broadcast("assets:progress", event));
  assetManager.on("statusChanged", () => broadcast("assets:statusChanged", undefined));
  // Startup reconciliation (manual state edits, upgrades, interrupted installs).
  // Must wait for init: getInstalled() is empty until the state file is loaded.
  // Then one background lookup of the latest engine releases; it honours the on-disk cache
  // TTL, so restarts don't spend the unauthenticated GitHub API budget. Nothing is installed.
  const ready = assetManager.init().then(() => adoptInstalledLc0(assetManager));
  void ready
    .then(syncEngines)
    .then(() => assetManager.refreshReleasesInBackground())
    .catch((error) => logger.error("asset-manager", "init failed:", error));

  const install = async (assetId: unknown): Promise<EngineAssetActionResult> => {
    try {
      await ready;
      await assetManager.downloadAsset(parseAssetId(assetId));
      await syncEngines();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  };

  ipcMain.handle("assets:status", async (_event, options: unknown): Promise<EngineAssetStatusMap> => {
    await ready;
    const refresh = typeof options === "object" && options !== null && (options as { refresh?: unknown }).refresh === true;
    return assetManager.getStatus({ refresh });
  });
  ipcMain.handle("assets:checkForUpdates", async (): Promise<EngineAssetStatusMap> => {
    await ready;
    return assetManager.checkForUpdates();
  });
  ipcMain.handle("assets:download", (_event, assetId: unknown) => install(assetId));
  // Same pipeline as a download: fetch the latest release, verify, swap the file in place.
  ipcMain.handle("assets:update", (_event, assetId: unknown) => install(assetId));
  ipcMain.handle("assets:downloadAll", async (): Promise<EngineAssetDownloadSummary> => {
    await ready;
    // Only what is missing and has a download for this platform (not Lc0 on macOS / Linux).
    const status = await assetManager.getStatus();
    const result = await assetManager.downloadAll(
      ALL_ASSET_IDS.filter((id) => status[id].state === "missing" && status[id].autoDownload)
    );
    await syncEngines();
    return result;
  });
  ipcMain.handle("assets:remove", async (_event, assetId: unknown) => {
    const id = parseAssetId(assetId);
    await assetManager.removeAsset(id);
    // Forgetting Lc0's path sticks: startup doesn't pick the same binary up again.
    if (id === "lc0") settingsRepository.set("lc0AutoDetect", false);
    await syncEngines();
  });
  ipcMain.handle("assets:setCustomPath", async (_event, assetId: unknown, customPath: unknown) => {
    const id = parseAssetId(assetId);
    await assetManager.setCustomPath(id, asAbsolutePath(customPath, "custom path"));
    if (id === "lc0") settingsRepository.set("lc0AutoDetect", true);
    await syncEngines();
  });
}

/** The library game an imported one is a copy of: its Lichess game, else its fingerprint. */
function findLibraryCopy(game: ImportedGame["game"]): string | null {
  const lichess = lichessGameId(game.headers.site);
  if (lichess) {
    const bySite = gameRepository.findIdBySite(`https://lichess.org/${lichess}`);
    if (bySite) return bySite;
  }
  return gameRepository.findIdByFingerprint(gameFingerprint({ headers: game.headers, rootFen: game.rootFen, moveTree: game.moveTree }));
}

/** Saved games, PGN files, downloadable databases and settings. */
function registerLibraryIpc(): void {
  ipcMain.handle("games:list", () => gameRepository.list());
  ipcMain.handle("games:get", (_event, id: unknown) => {
    const game = gameRepository.get(asId(id, "game id"));
    if (!game) throw new Error("Game not found");
    return game;
  });
  ipcMain.handle("games:getReview", (_event, gameId: unknown, reviewId: unknown) =>
    gameRepository.getReview(asId(gameId, "game id"), asId(reviewId, "review id"))
  );
  ipcMain.handle("games:save", (_event, value: unknown) => {
    const input = parseSaveGameInput(value);
    if (input.id && wasRecentlyDeleted(input.id)) throw new Error(SAVE_SUPPRESSED_AFTER_DELETE);
    return gameRepository.save(input);
  });
  ipcMain.handle("games:remove", (_event, value: unknown) => {
    const id = asId(value, "game id");
    recentlyDeletedGames.set(id, Date.now());
    gameRepository.remove(id);
  });
  ipcMain.handle("games:importPgn", (_event, input: unknown): ImportedGame => {
    const imported = importPgnText(parsePgnText(input));
    // The library already has this game: open that copy (with its analyses) instead of a new one.
    const existingGameId = findLibraryCopy(imported.game);
    if (existingGameId) return { ...imported, existingGameId };
    // Only the user imports a PGN (file or pasted text), so this is activity too.
    const telemetry = getTelemetry();
    telemetry?.record("game_imported", { source: "pgn", games: 1 });
    telemetry?.milestone("game_imported");
    telemetry?.markActive("study");
    return imported;
  });

  ipcMain.handle("databases:list", () => listInstalledDatabases());
  ipcMain.handle("databases:download", (_event, sourceId: unknown) =>
    downloadDatabase(asId(sourceId, "database source"), (progress) => broadcast("database:downloadProgress", progress))
  );
  ipcMain.handle("databases:remove", (_event, id: unknown) => removeDatabase(asId(id, "database id")));
  ipcMain.handle("databases:cancelDownload", (_event, sourceId: unknown) => cancelDownload(asId(sourceId, "database source")));
  ipcMain.handle("databases:activeDownloads", () => activeDownloads());
  ipcMain.handle("databases:samplePuzzle", (_event, input: unknown) => samplePuzzle(parsePuzzleSampleInput(input)));

  const pgnFilters = [{ name: "PGN files", extensions: ["pgn"] }];
  ipcMain.handle("files:openPgnFile", async (event) => {
    const result = await showOpenDialog(event, { properties: ["openFile"], filters: pgnFilters });
    const path = result.canceled ? undefined : result.filePaths[0];
    return path ? { path, contents: await readFile(path, "utf8") } : null;
  });
  // Writes only to the path the user picked in the native save dialog.
  ipcMain.handle("files:savePgnFile", async (event, defaultName: unknown, contents: unknown) => {
    const text = asString(contents, "PGN", 20 * 1024 * 1024);
    const result = await showSaveDialog(event, { defaultPath: parseDefaultFileName(defaultName), filters: pgnFilters });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, text, "utf8");
    return result.filePath;
  });
  const selectFile = async (event: IpcMainInvokeEvent, filters: Electron.FileFilter[]) => {
    const result = await showOpenDialog(event, { properties: ["openFile"], filters });
    const path = result.canceled ? null : (result.filePaths[0] ?? null);
    // A picture picked for an engine can be previewed before it's saved (see image-access.ts).
    allowChosenFile(path);
    return path;
  };
  ipcMain.handle("files:selectExecutable", (event) => selectFile(event, [{ name: "All files", extensions: ["*"] }]));
  ipcMain.handle("files:selectOpenFile", (event, filters: unknown) => {
    const parsed = parseDialogFilters(filters);
    return selectFile(event, parsed.length ? parsed : [{ name: "All files", extensions: ["*"] }]);
  });

  ipcMain.handle("settings:getAll", () => settingsRepository.getAll());
  const settingsChanged = (keys: readonly (keyof AppSettings)[]) => {
    // Turning usage analytics off deletes what wasn't sent yet; on starts collecting.
    if (keys.includes("usageAnalyticsEnabled")) {
      getTelemetry()?.refreshConsent();
      // Set up before the user opted in: the first funnel step is recorded now.
      noteEngineReadiness(true);
    }
    if (keys.includes("updatesAutoDownload")) updateService.applySettings();
  };
  ipcMain.handle("settings:set", (_event, key: unknown, value: unknown) => {
    const settingKey = parseSettingKey(key);
    settingsRepository.set(settingKey, parseSettingValue(settingKey, value));
    settingsChanged([settingKey]);
  });
  ipcMain.handle("settings:patch", (_event, value: unknown) => {
    const patch = parseSettingsPatch(value);
    settingsRepository.setMany(patch);
    settingsChanged(Object.keys(patch) as (keyof AppSettings)[]);
  });
}

/**
 * OpenRouter BYOK bridge. The key is accepted once from the settings form,
 * encrypted by the main process, and never returned to the renderer.
 */
function registerCommentaryIpc(): void {
  ipcMain.handle("commentary:getOpenRouterConfig", () => getOpenRouterConfigStore().get());
  ipcMain.handle("commentary:setOpenRouterConfig", (_event, value: unknown) => {
    const input = asObject(value, "OpenRouter configuration");
    if (input.apiKey !== undefined && input.apiKey !== null && typeof input.apiKey !== "string") {
      throw new Error("Invalid OpenRouter API key");
    }
    if (input.model !== undefined && typeof input.model !== "string") throw new Error("Invalid OpenRouter model");
    return getOpenRouterConfigStore().set({ model: input.model, apiKey: input.apiKey as string | null | undefined });
  });
  ipcMain.handle("commentary:generate", async (_event, input: unknown) => {
    const fields = input as { payloads?: unknown; context?: unknown } | undefined;
    const payloads = parseCommentaryPayloads(fields?.payloads);
    const store = getOpenRouterConfigStore();
    const [config, apiKey] = await Promise.all([store.get(), store.getApiKey()]);
    const telemetry = getTelemetry();
    const report = telemetry?.enabled
      ? commentaryReporter(telemetry, parseCommentaryRequestContext(fields?.context), {
          model: config.model,
          detail: payloads[0]?.commentaryDetail ?? null
        })
      : undefined;
    if (config.hasApiKey && !apiKey) {
      if (report) for (const payload of payloads) reportUnsent(report, payload.game.ply, "unreadable_key");
      return { commentary: [], error: UNREADABLE_API_KEY_ERROR };
    }
    return generateOpenRouterCommentary(payloads, { apiKey, model: config.model, report });
  });
}

/** Usage analytics: the renderer's few validated interaction reports, and the status for Settings. */
function registerTelemetryIpc(): void {
  ipcMain.handle("telemetry:status", () => {
    const telemetry = getTelemetry();
    return telemetry
      ? telemetry.status()
      : { available: false, reason: "not_configured", enabled: usageAnalyticsConsent(settingsRepository.getStored("usageAnalyticsEnabled")), pending: 0 };
  });
  ipcMain.handle("telemetry:track", (_event, value: unknown): boolean => {
    const telemetry = getTelemetry();
    if (!telemetry?.enabled) return false;
    return recordRendererEvent(telemetry, parseRendererEvent(value));
  });
}

/** In-app updates (main/updater.ts). No inputs: every action applies to the current update. */
function registerUpdateIpc(): void {
  updateService.on("state", (state) => broadcast("updates:state", state));
  ipcMain.handle("updates:getState", () => updateService.getState());
  ipcMain.handle("updates:check", () => updateService.check());
  ipcMain.handle("updates:download", () => updateService.download());
  ipcMain.handle("updates:install", () => updateService.install());
  ipcMain.handle("updates:openDownload", () => updateService.openDownload());
}

/** Lichess account, play and import (main/lichess). The OAuth token never leaves the main process. */
function registerLichessIpc(): void {
  const lichess = getLichessService();
  lichess.on("event", (event) => broadcast("lichess:event", event));
  const gameId = (value: unknown) => asLichessId(value, "game id");
  const challengeId = (value: unknown) => asLichessId(value, "challenge id");
  ipcMain.handle("lichess:status", () => lichess.status());
  ipcMain.handle("lichess:connect", () => lichess.connect());
  ipcMain.handle("lichess:cancelConnect", () => lichess.cancelConnect());
  ipcMain.handle("lichess:disconnect", async (_event, options: unknown) => {
    const input = parseLichessDisconnectInput(options);
    // Removed games must stay removed: a save already on its way (autosave) is refused like after
    // a single delete. Marked first, so no save can slip in between the delete and the marking.
    const removed = input.removeGames ? gameRepository.idsBySource("lichess") : [];
    const deletedAt = Date.now();
    for (const id of removed) recentlyDeletedGames.set(id, deletedAt);
    try {
      return await lichess.disconnect(input);
    } catch (error) {
      for (const id of removed) recentlyDeletedGames.delete(id);
      throw error;
    }
  });
  // The sync whose import is being recorded: callers that join a running sync share its promise,
  // and only the first records it.
  let recordedSync: Promise<unknown> | null = null;
  ipcMain.handle("lichess:syncGames", async () => {
    const sync = lichess.syncGames();
    if (sync === recordedSync) return sync;
    recordedSync = sync;
    const result = await sync.finally(() => {
      if (recordedSync === sync) recordedSync = null;
    });
    // A sync also runs on its own after connecting, so it isn't counted as activity.
    if (result.imported > 0) {
      getTelemetry()?.record("game_imported", { source: "lichess", games: result.imported });
      getTelemetry()?.milestone("game_imported");
    }
    return result;
  });
  ipcMain.handle("lichess:seek", (_event, input: unknown) => lichess.seek(parseLichessSeekInput(input)));
  ipcMain.handle("lichess:cancelSeek", () => lichess.cancelSeek());
  ipcMain.handle("lichess:challenge", (_event, input: unknown) =>
    lichess.challenge(parseLichessChallengeInput(input))
  );
  ipcMain.handle("lichess:challengeAi", (_event, input: unknown) =>
    lichess.challengeAi(parseLichessAiChallengeInput(input))
  );
  ipcMain.handle("lichess:acceptChallenge", (_event, id: unknown) => lichess.acceptChallenge(challengeId(id)));
  ipcMain.handle("lichess:declineChallenge", (_event, id: unknown) => lichess.declineChallenge(challengeId(id)));
  ipcMain.handle("lichess:cancelChallenge", (_event, id: unknown) => lichess.cancelChallenge(challengeId(id)));
  ipcMain.handle("lichess:challenges", () => lichess.challenges());
  ipcMain.handle("lichess:ongoingGames", () => lichess.ongoingGames());
  ipcMain.handle("lichess:watchGame", (_event, id: unknown) => lichess.watchGame(gameId(id)));
  ipcMain.handle("lichess:unwatchGame", (_event, id: unknown) => lichess.unwatchGame(gameId(id)));
  ipcMain.handle("lichess:move", (_event, id: unknown, uci: unknown) => lichess.move(gameId(id), asLichessUci(uci)));
  ipcMain.handle("lichess:resign", (_event, id: unknown) => lichess.resign(gameId(id)));
  ipcMain.handle("lichess:abort", (_event, id: unknown) => lichess.abort(gameId(id)));
  ipcMain.handle("lichess:offerDraw", (_event, id: unknown) => lichess.offerDraw(gameId(id)));
  ipcMain.handle("lichess:declineDraw", (_event, id: unknown) => lichess.declineDraw(gameId(id)));
}
