import { app, dialog, ipcMain } from "electron";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Decompress } from "fzstd";
import type { AppSettings } from "@chaturanga/shared/types/settings";
import type { CreateEngineInput, EngineConfig, ProbeEvalInput } from "@chaturanga/shared/types/engine";
import { SAVE_SUPPRESSED_AFTER_DELETE } from "@chaturanga/shared/ipc/game-handling";
import type { SaveGameInput } from "@chaturanga/shared/types/chess";
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import { externalDatabaseSources } from "@chaturanga/shared/types/database";
import type {
  InstalledDatabase,
  PuzzleSample,
  PuzzleSampleInput
} from "@chaturanga/shared/types/database";
import { fenAfterUci, statusForFen } from "@chaturanga/shared/chess/position";
import { engineRepository, externalDatabaseRepository, gameRepository, settingsRepository } from "../db/repositories";
import { listBundledEngines } from "../engine/bundled-engines";
import { engineConfigForId } from "../engine/engine-config";
import type { EngineManager } from "../engine/engine-manager";
import { reviewGameWithEngine } from "../engine/review";
import { probeEvalScore } from "../engine/probe-eval";

/** Guards against SQLite upsert resurrecting a row deleted moments earlier (autosave debounce races remove). */
const recentlyDeletedGameIds = new Map<string, number>();
const DELETE_GUARD_MS = 120_000;

function pruneStaleDeleteGuards(nowMs: number): void {
  for (const [gameId, t] of recentlyDeletedGameIds) {
    if (nowMs - t > DELETE_GUARD_MS) recentlyDeletedGameIds.delete(gameId);
  }
}

function markGameRecentlyDeleted(gameId: string): void {
  recentlyDeletedGameIds.set(gameId, Date.now());
}

function isRecentlyDeleted(gameId: string): boolean {
  const nowMs = Date.now();
  pruneStaleDeleteGuards(nowMs);
  return recentlyDeletedGameIds.has(gameId);
}

export function registerIpc(engineManager: EngineManager): void {
  ipcMain.handle("engines:list", () => {
    const bundled = listBundledEngines();
    const custom = engineRepository.list();
    return custom.some((engine) => engine.isDefault)
      ? [...bundled.map((engine) => ({ ...engine, isDefault: false })), ...custom]
      : [...bundled, ...custom];
  });
  ipcMain.handle("engines:create", (_event, input) => engineRepository.create(assertEngineInput(input)));
  ipcMain.handle("engines:update", (_event, id: string, patch) =>
    engineRepository.update(String(id), patch)
  );
  ipcMain.handle("engines:remove", (_event, id: string) => engineRepository.remove(String(id)));
  ipcMain.handle("engines:test", async (_event, idOrInput: string | CreateEngineInput) => {
    if (typeof idOrInput === "string") return engineManager.testEngine(idOrInput);
    const input = assertEngineInput(idOrInput);
    const config: EngineConfig = {
      id: "test",
      name: input.name,
      executablePath: input.executablePath,
      workingDirectory: input.workingDirectory ?? null,
      weightsPath: input.weightsPath ?? null,
      imagePath: input.imagePath ?? null,
      args: input.args ?? [],
      protocol: "uci",
      runtime: "custom-uci",
      isBundled: false,
      isAvailable: true,
      isDefault: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    return engineManager.testEngine(config);
  });
  ipcMain.handle("engines:startGame", async (_event, input) => {
    await engineManager.start(input);
  });
  ipcMain.handle("engines:startAnalysis", async (_event, input) => {
    await engineManager.startAnalysis(input);
  });
  ipcMain.handle("engines:probeEval", async (_event, input: ProbeEvalInput) => {
    engineManager.stop();
    const engineId = String(input?.engineId ?? "");
    const config = engineConfigForId(engineId);
    if (!config) throw new Error("Engine not found");
    const fen = String(input?.fen ?? "");
    const moves = Array.isArray(input?.moves) ? input.moves.map(String) : [];
    const movetimeMs = Number(input?.movetimeMs) || 400;
    return probeEvalScore(config, fen, moves, movetimeMs);
  });
  ipcMain.handle("engines:reviewGame", async (_event, input) => {
    const engineId = String(input?.engineId ?? "");
    const config = engineConfigForId(engineId);
    if (!config) throw new Error("Engine not found");
    const reviewId = String(input?.reviewId ?? `review-${Date.now()}`);
    engineManager.clearReviewCancellation(reviewId);
    const totalMoves = Array.isArray(input?.moves) ? input.moves.length : 0;
    try {
      const review = await reviewGameWithEngine(config, { ...input, reviewId }, {
        onPhaseProgress: (progress) => {
          engineManager.emit("reviewProgress", {
            reviewId,
            totalMoves,
            moveIndex: progress.moveIndex,
            nodeId: progress.nodeId,
            ply: progress.ply,
            san: progress.san,
            playedUci: Array.isArray(input?.moves) ? input.moves[progress.moveIndex]?.uci ?? "" : "",
            fenBefore: progress.fenBefore,
            fenAfter: progress.fenAfter,
            phase: progress.phase,
            fen: progress.fen,
            mover: progress.mover,
            depth: progress.depth,
            lines: progress.lines
          });
        },
        onMoveCompleted: ({ moveIndex, move }) => {
          engineManager.emit("reviewMoveCompleted", {
            reviewId,
            moveIndex,
            totalMoves,
            move
          });
        },
        shouldCancel: () => engineManager.isReviewCancelled(reviewId)
      });
      engineManager.emit("reviewCompleted", { reviewId, review });
      return review;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      engineManager.emit("reviewFailed", { reviewId, message });
      throw error;
    } finally {
      engineManager.clearReviewCancellation(reviewId);
    }
  });
  ipcMain.handle("engines:cancelReview", (_event, reviewId: string) => {
    engineManager.cancelReview(String(reviewId));
  });
  ipcMain.handle("engines:stop", () => engineManager.stop());

  ipcMain.handle("games:list", () => gameRepository.list());
  ipcMain.handle("games:get", (_event, id: string) => {
    const game = gameRepository.get(String(id));
    if (!game) throw new Error("Game not found");
    return game;
  });
  ipcMain.handle("games:save", (_event, input: SaveGameInput) => {
    const persistedId = input.id ?? null;
    if (persistedId && isRecentlyDeleted(String(persistedId))) {
      throw new Error(SAVE_SUPPRESSED_AFTER_DELETE);
    }
    return gameRepository.save(input);
  });
  ipcMain.handle("games:remove", (_event, id: string) => {
    const sid = String(id);
    markGameRecentlyDeleted(sid);
    gameRepository.remove(sid);
  });
  ipcMain.handle("games:importPgn", (_event, input: { pgn: string }) => importPgnText(input.pgn));
  ipcMain.handle("games:exportPgn", (_event, id: string) => {
    const game = gameRepository.get(String(id));
    if (!game) throw new Error("Game not found");
    return game.pgn;
  });

  ipcMain.handle("databases:list", () => listAvailableDatabases());
  ipcMain.handle("databases:download", async (event, sourceId: string) => {
    const source = externalDatabaseSources.find((item) => item.id === String(sourceId));
    if (!source) throw new Error("Database source not found");
    const dir = join(app.getPath("userData"), "databases");
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, `${source.id}-${basename(new URL(source.url).pathname)}`);
    const response = await fetch(source.url);
    if (!response.ok || !response.body) {
      throw new Error(`Download failed (${response.status} ${response.statusText})`);
    }
    const totalBytes = parseContentLength(response.headers.get("content-length"));
    try {
      await pipeline(
        progressStream(Readable.fromWeb(response.body as never), {
          sourceId: source.id,
          totalBytes,
          onProgress: (progress) =>
            event.sender.send("database:downloadProgress", progress)
        }),
        createWriteStream(filePath)
      );
    } catch (error) {
      event.sender.send("database:downloadProgress", {
        sourceId: source.id,
        downloadedBytes: 0,
        totalBytes,
        percent: null,
        state: "failed",
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
    const file = await stat(filePath);
    event.sender.send("database:downloadProgress", {
      sourceId: source.id,
      downloadedBytes: file.size,
      totalBytes: totalBytes ?? file.size,
      percent: 100,
      state: "completed"
    });
    return externalDatabaseRepository.saveDownloaded({
      source,
      filePath,
      fileSizeBytes: file.size,
      recordCount: source.expectedRecords ?? null
    });
  });
  ipcMain.handle("databases:remove", async (_event, id: string) => {
    const database = externalDatabaseRepository.get(String(id));
    if (!database) return;
    externalDatabaseRepository.remove(database.id);
    try {
      await unlink(database.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  });
  ipcMain.handle("databases:samplePuzzle", async (_event, input: PuzzleSampleInput) => {
    return samplePuzzleFromDatabase(input);
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

  ipcMain.handle(
    "files:selectOpenFile",
    async (_event, filters?: Array<{ name: string; extensions: string[] }>) => {
      const result = await dialog.showOpenDialog({
        properties: ["openFile"],
        filters:
          filters && filters.length > 0
            ? filters
            : [{ name: "All files", extensions: ["*"] }]
      });
      if (result.canceled || !result.filePaths[0]) return null;
      return result.filePaths[0];
    }
  );

  ipcMain.handle("settings:getAll", () => settingsRepository.getAll());
  ipcMain.handle("settings:set", (_event, key: keyof AppSettings, value: unknown) =>
    settingsRepository.set(key, value)
  );
}

function assertEngineInput(input: CreateEngineInput): CreateEngineInput {
  if (!input || typeof input !== "object") throw new Error("Invalid engine input");
  if (!input.executablePath?.trim()) throw new Error("Engine executable path is required");
  const workingDirectory = input.workingDirectory?.trim();
  const weightsPath = input.weightsPath?.trim();
  const imagePath = input.imagePath?.trim();
  return {
    ...input,
    name: input.name?.trim() || "UCI Engine",
    executablePath: input.executablePath.trim(),
    workingDirectory: workingDirectory || null,
    weightsPath: weightsPath || null,
    imagePath: imagePath || null,
    args: input.args ?? []
  };
}

function parseContentLength(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function progressStream(
  stream: NodeJS.ReadableStream,
  input: {
    sourceId: string;
    totalBytes: number | null;
    onProgress: (progress: {
      sourceId: string;
      downloadedBytes: number;
      totalBytes: number | null;
      percent: number | null;
      state: "downloading";
    }) => void;
  }
): NodeJS.ReadableStream {
  let downloadedBytes = 0;
  let lastEmitAt = 0;
  stream.on("data", (chunk: Buffer) => {
    downloadedBytes += chunk.byteLength;
    const now = Date.now();
    if (now - lastEmitAt < 120) return;
    lastEmitAt = now;
    input.onProgress({
      sourceId: input.sourceId,
      downloadedBytes,
      totalBytes: input.totalBytes,
      percent: input.totalBytes
        ? Math.min(99, Math.round((downloadedBytes / input.totalBytes) * 100))
        : null,
      state: "downloading"
    });
  });
  return stream;
}

async function samplePuzzleFromDatabase(input: PuzzleSampleInput): Promise<PuzzleSample> {
  const database = externalDatabaseRepository.get(input.databaseId);
  if (!database) throw new Error("Puzzle database not found. Download a database first.");
  await assertDatabaseFileExists(database);

  let selected: PuzzleSample | null = null;
  let matches = 0;
  const maxMatchesToSample = 500;
  const excludedIds = new Set(input.excludeIds ?? []);
  await scanCsvLines(database.filePath, database.format.endsWith(".zst"), (line, lineIndex) => {
    if (lineIndex === 0 || !line.trim()) return;
    const row = parseCsvLine(line);
    const sample =
      database.sourceId === "lichess-puzzles"
        ? sampleFromLichessRow(database, row, input)
        : sampleFromPositionRow(database, row, input);
    if (!sample) return;
    if (excludedIds.has(sample.id)) return;
    matches += 1;
    if (Math.random() < 1 / matches) selected = sample;
    if (matches >= maxMatchesToSample) return false;
  });

  if (!selected) {
    throw new Error("No puzzle matched those filters. Try fewer themes or a wider rating range.");
  }
  return selected;
}

async function listAvailableDatabases(): Promise<InstalledDatabase[]> {
  const databases = externalDatabaseRepository.list();
  const available: InstalledDatabase[] = [];
  for (const database of databases) {
    try {
      await stat(database.filePath);
      available.push(database);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        externalDatabaseRepository.remove(database.id);
        continue;
      }
      throw error;
    }
  }
  return available;
}

async function assertDatabaseFileExists(database: InstalledDatabase): Promise<void> {
  try {
    await stat(database.filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      externalDatabaseRepository.remove(database.id);
      throw new Error(`${database.name} is missing from disk. Download the database again.`, {
        cause: error
      });
    }
    throw error;
  }
}

function sampleFromLichessRow(
  database: InstalledDatabase,
  row: string[],
  input: PuzzleSampleInput
): PuzzleSample | null {
  const [id, fenBefore, movesRaw, ratingRaw, , popularityRaw, , themesRaw, gameUrl, openingsRaw] =
    row;
  if (!id || !fenBefore || !movesRaw) return null;
  const moves = movesRaw.trim().split(/\s+/).filter(Boolean);
  if (moves.length < 2) return null;
  const rating = Number(ratingRaw);
  const popularity = Number(popularityRaw);
  const themes = themesRaw ? themesRaw.split(/\s+/).filter(Boolean) : [];
  const openingTags = openingsRaw ? openingsRaw.split(/\s+/).filter(Boolean) : [];
  const initialFen = fenAfterUci(fenBefore, moves[0]);
  if (!initialFen) return null;
  const sideToMove = statusForFen(initialFen).turn;
  const filters = input.lichess;
  if (filters) {
    if (Number.isFinite(rating) && (rating < filters.ratingMin || rating > filters.ratingMax)) {
      return null;
    }
    if (Number.isFinite(popularity) && popularity < filters.popularityMin) return null;
    if (filters.themes.length && !filters.themes.every((theme) => themes.includes(theme))) {
      return null;
    }
    if (filters.openings.length && !filters.openings.some((opening) => openingTags.includes(opening))) {
      return null;
    }
    if (filters.lengths.length && !filters.lengths.some((length) => themes.includes(length))) {
      return null;
    }
    if (filters.side !== "any" && filters.side !== sideToMove) return null;
  }
  return {
    id,
    databaseId: database.id,
    sourceId: database.sourceId,
    sourceName: database.name,
    initialFen,
    fenBefore,
    opponentMove: moves[0],
    solutionMoves: moves.slice(1),
    rating: Number.isFinite(rating) ? rating : null,
    popularity: Number.isFinite(popularity) ? popularity : null,
    themes,
    gameUrl: gameUrl || null,
    openingTags,
    sideToMove,
    difficulty: null
  };
}

function sampleFromPositionRow(
  database: InstalledDatabase,
  row: string[],
  input: PuzzleSampleInput
): PuzzleSample | null {
  const [
    internalId,
    ,
    ,
    lichessUrl,
    fen,
    bestMove,
    difficultyRaw,
    ...tagValues
  ] = row;
  if (!internalId || !fen || !bestMove) return null;
  const difficulty = Number(difficultyRaw);
  const tagNames = [
    "initiative",
    "development",
    "endgame",
    "space",
    "trading",
    "prophylaxis",
    "coordination",
    "exploitingWeakness",
    "kingSafety",
    "restriction",
    "fixingStructure",
    "centreControl"
  ];
  const activeTags = tagNames.filter((_, index) => tagValues[index] === "1");
  const filters = input.position;
  if (filters) {
    if (
      Number.isFinite(difficulty) &&
      (difficulty < filters.difficultyMin || difficulty > filters.difficultyMax)
    ) {
      return null;
    }
    if (filters.tags.length && !filters.tags.every((tag) => activeTags.includes(tag))) return null;
  }
  return {
    id: internalId,
    databaseId: database.id,
    sourceId: database.sourceId,
    sourceName: database.name,
    initialFen: fen,
    opponentMove: null,
    solutionMoves: [bestMove],
    rating: null,
    popularity: null,
    themes: activeTags,
    gameUrl: lichessUrl || null,
    openingTags: [],
    sideToMove: statusForFen(fen).turn,
    difficulty: Number.isFinite(difficulty) ? difficulty : null
  };
}

async function scanCsvLines(
  filePath: string,
  compressed: boolean,
  onLine: (line: string, lineIndex: number) => boolean | void
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  let lineIndex = 0;
  let stopped = false;
  const emitText = (text: string) => {
    if (stopped) return false;
    buffer += text;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const shouldContinue = onLine(line, lineIndex);
      lineIndex += 1;
      if (shouldContinue === false) {
        stopped = true;
        return false;
      }
    }
    return true;
  };

  if (compressed) {
    const decompressor = new Decompress((chunk, final) => {
      emitText(decoder.decode(chunk, { stream: !final }));
    });
    for await (const chunk of createReadStream(filePath)) {
      decompressor.push(chunk as Buffer, false);
      if (stopped) break;
    }
    if (!stopped) decompressor.push(new Uint8Array(), true);
  } else {
    for await (const chunk of createReadStream(filePath, { encoding: "utf8" })) {
      if (!emitText(chunk)) return;
    }
  }

  if (stopped) return;
  const tail = buffer.trim();
  if (tail) onLine(tail, lineIndex);
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      result.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  result.push(current);
  return result;
}
