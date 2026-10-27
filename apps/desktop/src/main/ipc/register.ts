import { BrowserWindow, dialog, ipcMain, powerMonitor, type IpcMainInvokeEvent } from "electron";
import { settingKeys, type AppSettings } from "@chaturanga/shared/types/settings";
import { allowChosenFile } from "../image-access";
import { parseSettingWrite } from "./settings-values";
import type { EventEmitter } from "node:events";
import { readFile, stat, writeFile } from "node:fs/promises";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import { SAVE_SUPPRESSED_AFTER_DELETE } from "@chaturanga/shared/ipc/game-handling";
import type {
  EngineAssetActionResult,
  EngineAssetDownloadSummary,
  EngineAssetStatusMap
} from "@chaturanga/shared/ipc/chaturanga-api";
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import type { ImportedGame } from "@chaturanga/shared/types/chess";
import {
  gameRepository,
  retryOnceIfBusy,
  saveGameRetrying,
  settingsRepository
} from "../db/repositories";
import {
  activeDownloads,
  cancelDownload,
  downloadDatabase,
  removeDatabase
} from "../databases/external-databases";
import { listInstalledDatabases } from "../databases/installed-databases";
import { puzzleOfTheDay, samplePuzzle } from "../databases/puzzle-sampling";
import { engineConfigForId, listAllEngines } from "../engine/engine-config";
import { assertUciEngine, type EngineEvents, type EngineManager } from "../engine/engine-manager";
import { probeEvalScore } from "../engine/probe-eval";
import { ALL_ASSET_IDS, getAssetManager, isAssetId, type AssetId } from "../engine/asset-manager";
import { syncAssetsToEngineRegistry } from "../engine/engine-registry-sync";
import { disposeMaia3Evaluator } from "../maia";
import { withMaia3Fixture } from "../maia/model-path";
import { gameFingerprint, lichessGameId } from "../db/game-fingerprint";
import { detectLc0 } from "../engine/lc0-detect";
import { getOpenRouterConfigStore } from "../commentary/openrouter-config";
import { getLichessService } from "../lichess";
import { registerBroadcastIpc } from "../broadcasts";
import { getChesscomService } from "../chesscom";
import { getAccountRatings } from "../accounts";
import { errorMessage, logger } from "../logger";
import { updateService } from "../updater";
import { runGameReview, runPositionAnalysis } from "./review-handler";
import { missedBetween, readClocks, type ClockReading } from "../time-asleep";
import { parseCommentaryRequestContext } from "@chaturanga/shared/schemas/telemetry";
import { getTelemetry } from "../telemetry";
import { commentaryReporter } from "../telemetry/commentary";
import { usageAnalyticsConsent } from "../telemetry/config";
import { noteEngineReadiness } from "../telemetry/engine-readiness";
import { parseRendererEvent, recordRendererEvent } from "../telemetry/renderer-events";
import {
  asLichessId,
  asLichessUci,
  parseAnalysePositionsInput,
  parseDefaultFileName,
  parseDialogFilters,
  parseEngineInput,
  parseGameListQuery,
  parseLichessAiChallengeInput,
  parseLichessChallengeInput,
  parseChesscomConnectInput,
  parseDisconnectInput,
  parseLichessSeekInput,
  parsePgnText,
  parseProbeEvalInput,
  parsePuzzleOfTheDayInput,
  parsePuzzleSampleInput,
  parseReviewGameInput,
  parseSaveGameInput,
  parseSettingKey,
  parseSettingsPatch,
  parseStartAnalysisInput,
  parseStartGameInput
} from "./validate";
import { asAbsolutePath, asId, asObject, asString } from "./fields";
import { broadcast } from "./broadcast";
import { registerRepertoireIpc } from "./repertoire-handler";
import { registerPuzzleIpc } from "./puzzle-handler";
import { registerGamePuzzleIpc } from "./game-puzzles-handler";
import { noteReviewedGame, startGamePuzzleQueue } from "../game-puzzles";
import { engineImages, registerEngineCrudIpc } from "./engine-handler";
import { isRecord } from "@chaturanga/shared/types/guards";
import { RASTER_PICTURE_FILE_EXTENSIONS } from "@chaturanga/shared/types/pictures";

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
  registerChesscomIpc();
  registerProfileIpc();
  registerBooksIpc();
  registerBroadcastIpc();
  registerTelemetryIpc();
  registerRepertoireIpc();
  registerPuzzleIpc();
  // Resumes a queue persisted from the last run.
  registerGamePuzzleIpc(startGamePuzzleQueue(engineManager));
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

/** Maia (the Maia 3 row) evaluates nothing: an evaluation asked of it fails at once, saying so. */
function refuseMaiaEvaluation(engineId: string, use: string): void {
  const config = engineConfigForId(engineId);
  if (config) assertUciEngine(config, use);
}

function registerEngineIpc(engineManager: EngineManager): void {
  ipcMain.handle("engines:list", () => listAllEngines());
  registerEngineCrudIpc();
  ipcMain.handle("engines:test", (_event, idOrInput: unknown) =>
    engineManager.testEngine(testConfigFor(idOrInput))
  );
  ipcMain.handle("engines:startGame", (_event, input: unknown) =>
    engineManager.start(parseStartGameInput(input))
  );
  ipcMain.handle("engines:startAnalysis", (_event, input: unknown) =>
    engineManager.startAnalysis(parseStartAnalysisInput(input))
  );
  ipcMain.handle("engines:probeEval", (_event, value: unknown) => {
    const input = parseProbeEvalInput(value);
    const config = engineConfigForId(input.engineId);
    if (!config) throw new Error("Engine not found");
    assertUciEngine(config, "a draw probe");
    // The warm process (lc0's network) has exited first, and no search starts one during the probe.
    return engineManager.runExclusive(() =>
      probeEvalScore(config, input.fen, input.moves, input.movetimeMs)
    );
  });
  ipcMain.handle("engines:reviewGame", (_event, value: unknown) => {
    const input = parseReviewGameInput(value);
    refuseMaiaEvaluation(input.engineId, "a review's evaluation");
    noteReviewedGame(input.reviewId, input.gameId);
    return runGameReview(engineManager, input);
  });
  ipcMain.handle("engines:cancelReview", (_event, reviewId: unknown) =>
    engineManager.cancelReview(asId(reviewId, "review id"))
  );
  ipcMain.handle("engines:analysePositions", (_event, value: unknown) => {
    const input = parseAnalysePositionsInput(value);
    refuseMaiaEvaluation(input.engineId, "position analysis");
    return runPositionAnalysis(engineManager, input);
  });
  ipcMain.handle("engines:maiaCurve", async (_event, input: unknown) => {
    const { maiaCurve, parseMaiaCurveInput } = await import("./maia-curve");
    return maiaCurve(parseMaiaCurveInput(input));
  });
  ipcMain.handle("engines:stop", () => engineManager.stop());
}

/**
 * Lc0 has no download on macOS or Linux, so it only works once the user points the app at their
 * own Lc0. One they installed in the usual place (e.g. Homebrew) is picked up at startup instead.
 * Never replaces a path the user chose, never comes back after they forgot it (until they choose
 * one again), and never fails startup.
 */
async function adoptInstalledLc0(assetManager: ReturnType<typeof getAssetManager>): Promise<void> {
  try {
    if (settingsRepository.getStored("lc0AutoDetect") === false) return;
    const current = assetManager.getInstalled().lc0;
    if (current.state !== "missing") return;
    const found = await detectLc0();
    if (!found) return;
    await assetManager.setCustomPath("lc0", found);
    logger.info("asset-manager", `using the Lc0 found at ${found}`);
  } catch (error) {
    logger.warn("asset-manager", "looking for an installed Lc0 failed:", errorMessage(error));
  }
}

/** Engine binary, network and Maia 3 model downloads, mirrored into the engines table. */
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
  // Managed engines the sync removed lose their picture copies, as `engines:remove` does.
  const syncEngines = () =>
    syncAssetsToEngineRegistry()
      .then(async (removed) => {
        broadcast("engines:changed", undefined);
        noteEngineReadiness(false);
        const images = engineImages();
        await Promise.all(removed.map((id) => images.exclusive(id, () => images.prune(id, null))));
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

  // A host still open would keep reading the model it loaded (until five idle minutes close it)
  // while reviews record the new one: close it, and the next request loads the new model. (Only
  // a missing model is downloaded with the others: no host can be open on it.)
  const modelChanged = (ids: readonly AssetId[]) => {
    if (ids.includes("maia3")) disposeMaia3Evaluator();
  };

  const install = async (assetId: unknown): Promise<EngineAssetActionResult> => {
    try {
      await ready;
      const id = parseAssetId(assetId);
      await assetManager.downloadAsset(id);
      modelChanged([id]);
      await syncEngines();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  };

  ipcMain.handle(
    "assets:status",
    async (_event, options: unknown): Promise<EngineAssetStatusMap> => {
      await ready;
      const refresh =
        typeof options === "object" &&
        options !== null &&
        (options as { refresh?: unknown }).refresh === true;
      return withMaia3Fixture(await assetManager.getStatus({ refresh }));
    }
  );
  ipcMain.handle("assets:checkForUpdates", async (): Promise<EngineAssetStatusMap> => {
    await ready;
    return withMaia3Fixture(await assetManager.checkForUpdates());
  });
  ipcMain.handle("assets:download", (_event, assetId: unknown) => install(assetId));
  // Same pipeline as a download: fetch the latest release, verify, swap the file in place.
  ipcMain.handle("assets:update", (_event, assetId: unknown) => install(assetId));
  ipcMain.handle("assets:downloadAll", async (): Promise<EngineAssetDownloadSummary> => {
    await ready;
    // Only what is missing and has a download for this platform (not Lc0 on macOS / Linux).
    const status = withMaia3Fixture(await assetManager.getStatus());
    const result = await assetManager.downloadAll(
      ALL_ASSET_IDS.filter((id) => status[id].state === "missing" && status[id].autoDownload)
    );
    await syncEngines();
    return result;
  });
  ipcMain.handle("assets:remove", async (_event, assetId: unknown) => {
    const id = parseAssetId(assetId);
    await assetManager.removeAsset(id);
    modelChanged([id]);
    // Forgetting Lc0's path sticks: startup doesn't pick the same binary up again.
    if (id === "lc0") settingsRepository.set("lc0AutoDetect", false);
    await syncEngines();
  });
  ipcMain.handle("assets:setCustomPath", async (_event, assetId: unknown, customPath: unknown) => {
    const id = parseAssetId(assetId);
    await assetManager.setCustomPath(id, asAbsolutePath(customPath, "custom path"));
    modelChanged([id]);
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
  const fingerprint = gameFingerprint({
    headers: game.headers,
    rootFen: game.rootFen,
    moveTree: game.moveTree
  });
  return fingerprint ? gameRepository.findIdByFingerprint(fingerprint) : null;
}

/** Saved games, PGN files, downloadable databases and settings. */
function registerLibraryIpc(): void {
  ipcMain.handle("games:listPage", (_event, query: unknown) =>
    gameRepository.listPage(parseGameListQuery(query))
  );
  ipcMain.handle("games:facets", (_event, excludeId: unknown) =>
    gameRepository.facets(
      excludeId === null || excludeId === undefined ? null : asId(excludeId, "game id")
    )
  );
  ipcMain.handle("games:get", (_event, id: unknown) => {
    const game = gameRepository.get(asId(id, "game id"));
    if (!game) throw new Error("Game not found");
    return game;
  });
  ipcMain.handle("games:latestUnfinishedEngineGame", () =>
    gameRepository.latestUnfinishedEngineGame()
  );
  ipcMain.handle("games:getReview", (_event, gameId: unknown, reviewId: unknown) =>
    gameRepository.getReview(asId(gameId, "game id"), asId(reviewId, "review id"))
  );
  // Deleting analyses never deletes the game; each resolves once the rows are gone.
  ipcMain.handle("games:removeReview", async (_event, gameId: unknown, reviewId: unknown) => {
    const game = asId(gameId, "game id");
    const review = asId(reviewId, "review id");
    await retryOnceIfBusy(() => gameRepository.removeReview(game, review));
  });
  ipcMain.handle("games:removeReviews", async (_event, gameId: unknown) => {
    const game = asId(gameId, "game id");
    await retryOnceIfBusy(() => gameRepository.removeReviews(game));
  });
  ipcMain.handle("games:save", (_event, value: unknown) => {
    // A save landing while the import writer or a backup restore holds the write lock gets one
    // more try.
    return saveGameRetrying(parseSaveGameInput(value), (gameId) =>
      wasRecentlyDeleted(gameId) ? new Error(SAVE_SUPPRESSED_AFTER_DELETE) : null
    );
  });
  ipcMain.handle("games:remove", async (_event, value: unknown) => {
    const id = asId(value, "game id");
    recentlyDeletedGames.set(id, Date.now());
    await retryOnceIfBusy(() => gameRepository.remove(id));
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
    downloadDatabase(asId(sourceId, "database source"), (progress) =>
      broadcast("database:downloadProgress", progress)
    )
  );
  ipcMain.handle("databases:remove", (_event, id: unknown) =>
    removeDatabase(asId(id, "database id"))
  );
  ipcMain.handle("databases:cancelDownload", (_event, sourceId: unknown) =>
    cancelDownload(asId(sourceId, "database source"))
  );
  ipcMain.handle("databases:activeDownloads", () => activeDownloads());
  ipcMain.handle("databases:samplePuzzle", (_event, input: unknown) =>
    samplePuzzle(parsePuzzleSampleInput(input))
  );
  ipcMain.handle("databases:puzzleOfTheDay", (_event, input: unknown) =>
    puzzleOfTheDay(parsePuzzleOfTheDayInput(input))
  );

  const pgnFilters = [{ name: "PGN files", extensions: ["pgn"] }];
  const maxPgnFileBytes = 20 * 1024 * 1024;
  ipcMain.handle("files:openPgnFile", async (event) => {
    const result = await showOpenDialog(event, { properties: ["openFile"], filters: pgnFilters });
    const path = result.canceled ? undefined : result.filePaths[0];
    if (!path) return null;
    // Checked before reading, so an oversized file is never loaded or sent over IPC.
    if ((await stat(path)).size > maxPgnFileBytes)
      throw new Error("That PGN file is larger than 20 MiB.");
    return { path, contents: await readFile(path, "utf8") };
  });
  // Writes only to the path the user picked in the native save dialog.
  ipcMain.handle("files:savePgnFile", async (event, defaultName: unknown, contents: unknown) => {
    const text = asString(contents, "PGN", 20 * 1024 * 1024);
    const result = await showSaveDialog(event, {
      defaultPath: parseDefaultFileName(defaultName),
      filters: pgnFilters
    });
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
  ipcMain.handle("files:selectExecutable", (event) =>
    selectFile(event, [{ name: "All files", extensions: ["*"] }])
  );
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
    // Another account picked to fill the ratings: they follow it now.
    if (keys.includes("ratingsAccount")) void getAccountRatings().apply();
  };
  ipcMain.handle("settings:set", async (_event, key: unknown, value: unknown) => {
    const settingKey = parseSettingKey(key);
    const written = parseSettingWrite(settingKey, value);
    await retryOnceIfBusy(() => settingsRepository.setMany(written));
    settingsChanged(settingKeys(written));
  });
  ipcMain.handle("settings:patch", async (_event, value: unknown) => {
    const patch = parseSettingsPatch(value);
    await retryOnceIfBusy(() => settingsRepository.setMany(patch));
    settingsChanged(settingKeys(patch));
  });
}

/**
 * OpenRouter BYOK bridge. The key is accepted once from the settings form,
 * encrypted by the main process, and never returned to the renderer. The coach (its prompts,
 * checks and payload schemas) loads with the first request, so the main bundle doesn't carry it.
 */
function registerCommentaryIpc(): void {
  const coach = () => import("../commentary/openrouter-commentary");
  ipcMain.handle("commentary:getOpenRouterConfig", () => getOpenRouterConfigStore().get());
  ipcMain.handle("commentary:setOpenRouterConfig", (_event, value: unknown) => {
    const input = asObject(value, "OpenRouter configuration");
    if (input.apiKey !== undefined && input.apiKey !== null && typeof input.apiKey !== "string") {
      throw new Error("Invalid OpenRouter API key");
    }
    const model = (value: unknown) => {
      if (value !== undefined && typeof value !== "string")
        throw new Error("Invalid OpenRouter model");
      return value;
    };
    return getOpenRouterConfigStore().set({
      model: model(input.model),
      bookOcrModel: model(input.bookOcrModel),
      apiKey: input.apiKey
    });
  });
  ipcMain.handle("commentary:generate", async (_event, input: unknown) => {
    const fields = isRecord(input) ? input : undefined;
    const commentary = await coach();
    const payloads = commentary.parseCommentaryPayloads(fields?.payloads);
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
      if (report)
        for (const payload of payloads)
          commentary.reportUnsent(report, payload.game.ply, "unreadable_key");
      return { commentary: [], error: commentary.UNREADABLE_API_KEY_ERROR };
    }
    return commentary.generateOpenRouterCommentary(payloads, {
      apiKey,
      model: config.model,
      report
    });
  });
  // A finished puzzle's explanation; the renderer cancels it when the user moves to another puzzle.
  const puzzleRequests = new Map<string, AbortController>();
  ipcMain.handle("commentary:explainPuzzle", async (_event, input: unknown) => {
    const fields = asObject(input, "puzzle explanation");
    const requestId = asId(fields.requestId, "request id");
    // Registered before the coach loads, so a cancel sent meanwhile still reaches this request.
    const controller = new AbortController();
    puzzleRequests.get(requestId)?.abort();
    puzzleRequests.set(requestId, controller);
    try {
      const commentary = await coach();
      const payload = commentary.parsePuzzleExplanationPayload(fields.payload);
      const store = getOpenRouterConfigStore();
      const [config, apiKey] = await Promise.all([store.get(), store.getApiKey()]);
      if (config.hasApiKey && !apiKey)
        return { explanation: null, error: commentary.UNREADABLE_API_KEY_ERROR };
      return await commentary.explainPuzzleWithOpenRouter(payload, {
        apiKey,
        model: config.model,
        signal: controller.signal
      });
    } finally {
      if (puzzleRequests.get(requestId) === controller) puzzleRequests.delete(requestId);
    }
  });
  ipcMain.handle("commentary:cancelPuzzleExplanation", (_event, requestId: unknown) => {
    puzzleRequests.get(asId(requestId, "request id"))?.abort();
  });
}

/** Usage analytics: the renderer's few validated interaction reports, and the status for Settings. */
function registerTelemetryIpc(): void {
  ipcMain.handle("telemetry:status", () => {
    const telemetry = getTelemetry();
    return telemetry
      ? telemetry.status()
      : {
          available: false,
          reason: "not_configured",
          enabled: usageAnalyticsConsent(settingsRepository.getStored("usageAnalyticsEnabled")),
          pending: 0
        };
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

/**
 * Your picture (main/profile-picture), loaded in the background now (nothing waits for it): it
 * starts following the accounts right away, as an account's picture may need downloading. The
 * file dialog runs here; the module reads the picture picked for the renderer to crop, and stores
 * the crop.
 */
function registerProfileIpc(): void {
  const profile = () => import("../profile-picture");
  profile().then(
    (pictures) => pictures.startProfilePictures(),
    (error: unknown) => logger.error("profile-picture", "loading failed:", error)
  );
  ipcMain.handle("profile:picture", () => profile().then((pictures) => pictures.profilePicture()));
  ipcMain.handle("profile:openPicture", async (event) => {
    const result = await showOpenDialog(event, {
      properties: ["openFile"],
      filters: [{ name: "Pictures", extensions: RASTER_PICTURE_FILE_EXTENSIONS }]
    });
    const path = result.canceled ? null : (result.filePaths[0] ?? null);
    return (await profile()).openProfilePicture(path);
  });
  ipcMain.handle("profile:originalPicture", () =>
    profile().then((pictures) => pictures.originalProfilePicture())
  );
  // The payload is checked by the module (saveProfilePicture), off the main bundle.
  ipcMain.handle("profile:savePicture", (_event, input: unknown) =>
    profile().then((pictures) => pictures.saveProfilePicture(input))
  );
  ipcMain.handle("profile:removePicture", () =>
    profile().then((pictures) => pictures.removeProfilePicture())
  );
}

/**
 * Chess book import (main/books), loaded with the first request: the renderer renders the PDF and
 * sends its pages; main reads them with OpenRouter (the key stays here) and writes the repertoire.
 */
function registerBooksIpc(): void {
  const books = () => import("../books");
  ipcMain.handle("books:estimate", async (_e, input: unknown) =>
    (await books()).estimateBook(input)
  );
  ipcMain.handle("books:create", async (_e, input: unknown) => (await books()).createBook(input));
  ipcMain.handle("books:addPage", async (_e, input: unknown) => (await books()).addBookPage(input));
  ipcMain.handle("books:start", async (_e, id: unknown) => (await books()).startBook(id));
  ipcMain.handle("books:resume", async (_e, id: unknown) => (await books()).resumeBook(id));
  ipcMain.handle("books:cancel", async (_e, id: unknown) => (await books()).cancelBook(id));
  ipcMain.handle("books:get", async (_e, id: unknown) => (await books()).getBook(id));
  ipcMain.handle("books:list", async () => (await books()).listBooks());
  ipcMain.handle("books:remove", async (_e, id: unknown) => (await books()).removeBook(id));
  ipcMain.handle("books:getPages", async (_e, id: unknown) => (await books()).bookPages(id));
}

/**
 * The chess.com account and its import (main/chesscom). Every request to chess.com is made here;
 * the renderer only names the username.
 */
function registerChesscomIpc(): void {
  const chesscom = getChesscomService();
  chesscom.on("event", (event) => broadcast("chesscom:event", event));
  ipcMain.handle("chesscom:status", () => chesscom.status());
  ipcMain.handle("chesscom:connect", (_event, input: unknown) =>
    chesscom.connect(parseChesscomConnectInput(input))
  );
  ipcMain.handle("chesscom:disconnect", async (_event, options: unknown) => {
    const input = parseDisconnectInput(options);
    // Removed games stay removed: a save already on its way (autosave) is refused, as after a
    // single delete. Marked first, so no save can slip in between the delete and the marking.
    const removed = input.removeGames ? gameRepository.idsBySource("chesscom") : [];
    const deletedAt = Date.now();
    for (const id of removed) recentlyDeletedGames.set(id, deletedAt);
    try {
      return await chesscom.disconnect(input);
    } catch (error) {
      for (const id of removed) recentlyDeletedGames.delete(id);
      throw error;
    }
  });
  // As for Lichess: callers joining a running sync share its promise; only the first records it.
  let recordedSync: Promise<unknown> | null = null;
  ipcMain.handle("chesscom:syncGames", async () => {
    const sync = chesscom.syncGames();
    if (sync === recordedSync) return sync;
    recordedSync = sync;
    const result = await sync.finally(() => {
      if (recordedSync === sync) recordedSync = null;
    });
    if (result.imported > 0) {
      getTelemetry()?.record("game_imported", { source: "chesscom", games: result.imported });
      getTelemetry()?.milestone("game_imported");
    }
    return result;
  });
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
    const input = parseDisconnectInput(options);
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
  ipcMain.handle("lichess:seek", (_event, input: unknown) =>
    lichess.seek(parseLichessSeekInput(input))
  );
  ipcMain.handle("lichess:cancelSeek", () => lichess.cancelSeek());
  ipcMain.handle("lichess:challenge", (_event, input: unknown) =>
    lichess.challenge(parseLichessChallengeInput(input))
  );
  ipcMain.handle("lichess:challengeAi", (_event, input: unknown) =>
    lichess.challengeAi(parseLichessAiChallengeInput(input))
  );
  ipcMain.handle("lichess:acceptChallenge", (_event, id: unknown) =>
    lichess.acceptChallenge(challengeId(id))
  );
  ipcMain.handle("lichess:declineChallenge", (_event, id: unknown) =>
    lichess.declineChallenge(challengeId(id))
  );
  ipcMain.handle("lichess:cancelChallenge", (_event, id: unknown) =>
    lichess.cancelChallenge(challengeId(id))
  );
  ipcMain.handle("lichess:challenges", () => lichess.challenges());
  ipcMain.handle("lichess:ongoingGames", () => lichess.ongoingGames());
  ipcMain.handle("lichess:playing", () => lichess.playing());
  ipcMain.handle("lichess:watchGame", (_event, id: unknown) => lichess.watchGame(gameId(id)));
  ipcMain.handle("lichess:unwatchGame", (_event, id: unknown) => lichess.unwatchGame(gameId(id)));
  ipcMain.handle("lichess:move", (_event, id: unknown, uci: unknown) =>
    lichess.move(gameId(id), asLichessUci(uci))
  );
  ipcMain.handle("lichess:resign", (_event, id: unknown) => lichess.resign(gameId(id)));
  ipcMain.handle("lichess:abort", (_event, id: unknown) => lichess.abort(gameId(id)));
  ipcMain.handle("lichess:offerDraw", (_event, id: unknown) => lichess.offerDraw(gameId(id)));
  ipcMain.handle("lichess:declineDraw", (_event, id: unknown) => lichess.declineDraw(gameId(id)));
}
