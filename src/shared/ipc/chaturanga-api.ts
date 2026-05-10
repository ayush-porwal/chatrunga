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
  EngineTestResult,
  StartEngineGameInput,
  UpdateEngineInput
} from "../types/engine";
import type { AppSettings } from "../types/settings";

export type Unsubscribe = () => void;

export type ChaturangaApi = {
  engines: {
    list(): Promise<EngineConfig[]>;
    create(input: CreateEngineInput): Promise<EngineConfig>;
    update(id: string, patch: UpdateEngineInput): Promise<EngineConfig>;
    remove(id: string): Promise<void>;
    test(idOrInput: string | CreateEngineInput): Promise<EngineTestResult>;
    startGame(input: StartEngineGameInput): Promise<void>;
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
  files: {
    openPgnFile(): Promise<{ path: string; contents: string } | null>;
    savePgnFile(defaultName: string, contents: string): Promise<string | null>;
    selectExecutable(): Promise<string | null>;
  };
  settings: {
    getAll(): Promise<AppSettings>;
    set(key: keyof AppSettings, value: unknown): Promise<void>;
  };
  events: {
    onEngineInfo(callback: (info: EngineInfo) => void): Unsubscribe;
    onEngineBestMove(callback: (move: EngineBestMove) => void): Unsubscribe;
    onEngineError(callback: (error: EngineError) => void): Unsubscribe;
  };
};

declare global {
  interface Window {
    chaturanga: ChaturangaApi;
  }
}
