import type {
  GameSummary,
  ImportedGame,
  ImportPgnInput,
  SavedGame,
  SaveGameInput
} from "../types/chess";
import type {
  CreateEngineInput,
  EngineBestMove,
  EngineConfig,
  EngineError,
  EngineInfo,
  EngineScore,
  EngineTestResult,
  GameReview,
  ProbeEvalInput,
  ReviewCompleted,
  ReviewFailed,
  ReviewGameInput,
  ReviewMoveCompleted,
  ReviewProgress,
  StartLiveAnalysisInput,
  StartEngineGameInput,
  UpdateEngineInput
} from "../types/engine";
import type { AppSettings } from "../types/settings";
import type {
  DatabaseDownloadProgress,
  InstalledDatabase,
  PuzzleSample,
  PuzzleSampleInput
} from "../types/database";

export type Unsubscribe = () => void;

/** Electron `dialog.showOpenDialog` filter shape */
export type DialogFileFilter = { name: string; extensions: string[] };

export type ChaturangaApi = {
  environment: {
    isElectron: true;
    platform: NodeJS.Platform;
  };
  /**
   * Root-level IPC for draw-offer probing (same handler as `engines.probeEval`).
   * Prefer this at runtime: older dev sessions occasionally expose a stale `engines` object without nested methods.
   */
  enginesProbeEval(input: ProbeEvalInput): Promise<EngineScore | null>;
  engines: {
    list(): Promise<EngineConfig[]>;
    create(input: CreateEngineInput): Promise<EngineConfig>;
    update(id: string, patch: UpdateEngineInput): Promise<EngineConfig>;
    remove(id: string): Promise<void>;
    test(idOrInput: string | CreateEngineInput): Promise<EngineTestResult>;
    startGame(input: StartEngineGameInput): Promise<void>;
    startAnalysis(input: StartLiveAnalysisInput): Promise<void>;
    probeEval(input: ProbeEvalInput): Promise<EngineScore | null>;
    reviewGame(input: ReviewGameInput): Promise<GameReview>;
    cancelReview(reviewId: string): Promise<void>;
    stop(): Promise<void>;
  };
  games: {
    list(): Promise<GameSummary[]>;
    get(id: string): Promise<SavedGame>;
    save(input: SaveGameInput): Promise<SavedGame>;
    remove(id: string): Promise<void>;
    importPgn(input: ImportPgnInput): Promise<ImportedGame>;
    exportPgn(gameId: string): Promise<string>;
  };
  databases: {
    list(): Promise<InstalledDatabase[]>;
    download(sourceId: string): Promise<InstalledDatabase>;
    samplePuzzle(input: PuzzleSampleInput): Promise<PuzzleSample>;
    remove(id: string): Promise<void>;
  };
  files: {
    openPgnFile(): Promise<{ path: string; contents: string } | null>;
    savePgnFile(defaultName: string, contents: string): Promise<string | null>;
    selectExecutable(): Promise<string | null>;
    selectOpenFile(filters?: DialogFileFilter[]): Promise<string | null>;
  };
  settings: {
    getAll(): Promise<AppSettings>;
    set(key: keyof AppSettings, value: unknown): Promise<void>;
  };
  events: {
    onEngineInfo(callback: (info: EngineInfo) => void): Unsubscribe;
    onEngineBestMove(callback: (move: EngineBestMove) => void): Unsubscribe;
    onEngineError(callback: (error: EngineError) => void): Unsubscribe;
    onReviewProgress(callback: (progress: ReviewProgress) => void): Unsubscribe;
    onReviewMoveCompleted(callback: (event: ReviewMoveCompleted) => void): Unsubscribe;
    onReviewCompleted(callback: (event: ReviewCompleted) => void): Unsubscribe;
    onReviewFailed(callback: (event: ReviewFailed) => void): Unsubscribe;
    onDatabaseDownloadProgress(callback: (progress: DatabaseDownloadProgress) => void): Unsubscribe;
  };
};

declare global {
  interface Window {
    chaturanga?: ChaturangaApi;
  }
}
