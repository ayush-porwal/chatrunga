import type { CommentaryRequestContext, TelemetryRendererEvent, TelemetryStatus } from "../types/telemetry";
import type {
  GameLibraryFacets,
  GameListPage,
  GameListQuery,
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
  ReviewCommentary,
  ReviewMoveCompleted,
  ReviewProgress,
  StartLiveAnalysisInput,
  StartEngineGameInput,
  UpdateEngineInput
} from "../types/engine";
import type { AppSettings } from "../types/settings";
import type { UpdateState } from "../types/updates";
import type {
  LichessAiChallengeInput,
  LichessChallenge,
  LichessChallengeInput,
  LichessEvent,
  LichessSeekInput,
  LichessStatus,
  LichessSyncResult
} from "../types/lichess";
import type { ReviewInsightPayload } from "../schemas/review-insight";
import type {
  DatabaseDownloadProgress,
  InstalledDatabase,
  PuzzleSample,
  PuzzleSampleInput
} from "../types/database";

import type {
  ArchiveRepertoireInput,
  AttemptResult,
  ChapterSaveResult,
  CreateRepertoireInput,
  DecisionSaveResult,
  DuplicateRepertoireInput,
  ExportInput,
  ExportResult,
  ImportCommitInput,
  ImportPreview,
  ImportResult,
  PracticeActionInput,
  PracticeActionResult,
  PracticeSessionSnapshot,
  PracticeSummary,
  PreviewImportInput,
  RecordAttemptInput,
  RemoveChapterInput,
  RemoveRepertoireInput,
  RepertoireChangedEvent,
  RepertoireChangeResult,
  RepertoireChapter,
  RepertoireDecision,
  RepertoireDetail,
  RepertoireDueSummary,
  RepertoireListFilters,
  RepertoireSummary,
  SaveChapterInput,
  SaveWorkspaceInput,
  StartPracticeInput,
  UpdateDecisionInput,
  UpdateRepertoireMetadataInput
} from "../types/repertoire";

export type Unsubscribe = () => void;

/** Electron `dialog.showOpenDialog` filter shape */
export type DialogFileFilter = { name: string; extensions: string[] };

export type OpenRouterConfigSummary = {
  model: string;
  /** The renderer can display configuration state, but never receives the key. */
  hasApiKey: boolean;
};

export type SetOpenRouterConfigInput = {
  model?: string;
  /** `undefined` keeps the current key; `null` removes it. */
  apiKey?: string | null;
};

export type GenerateCommentaryInput = {
  payloads: ReviewInsightPayload[];
  /** Usage analytics correlation (which review, and whether Retry asked); optional. */
  context?: CommentaryRequestContext;
};

export type GenerateCommentaryResult = {
  commentary: ReviewCommentary[];
  error: string | null;
};

/**
 * Window translucency ("glass"): macOS vibrancy behind the sidebar and titlebar. The renderer
 * mirrors `active` as the `glass` class on <html>, which makes the chrome surfaces translucent.
 */
export type WindowGlassState = {
  /** The platform can show it (macOS). */
  supported: boolean;
  /** Always on (there's no setting any more); kept for the state's shape. */
  enabled: boolean;
  /** macOS System Settings → Accessibility → Display → Reduce transparency is on. */
  reducedTransparency: boolean;
  /** Vibrancy is on right now: supported, enabled and not reduced. */
  active: boolean;
};

/** `process.platform`, spelled out so the renderer (which has no Node types) can use it. */
export type Platform = "aix" | "android" | "darwin" | "freebsd" | "haiku" | "linux" | "openbsd" | "sunos" | "win32" | "cygwin" | "netbsd";

export type ChaturangaApi = {
  environment: {
    isElectron: true;
    platform: Platform;
  };
  system: {
    /**
     * Total time the computer slept that a monotonic clock didn't count (synchronous; match
     * clocks add it, see clockNow).
     */
    timeAsleepMs(): number;
    /** The computer woke up (the time asleep changed). */
    onResumed(callback: () => void): Unsubscribe;
  };
  appearance: {
    /** Current glass state (synchronous: read before the first render so the first frame is right). */
    getGlass(): WindowGlassState;
    /** Page zoom factor (Cmd +/−; persisted per origin by Chromium). 1 = 100%. */
    getZoomFactor(): number;
    /** Fired when the setting or the system Reduce transparency preference changes. */
    onGlassChanged(callback: (state: WindowGlassState) => void): Unsubscribe;
    /** The first frame with real content has been committed: the main process may show the window. */
    rendererReady(): void;
  };
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
    /** One page of the library, newest first (filtered and searched in the database). */
    listPage(query: GameListQuery): Promise<GameListPage>;
    /** Which filters the library has games for, leaving out `excludeId`. */
    facets(excludeId: string | null): Promise<GameLibraryFacets>;
    get(id: string): Promise<SavedGame>;
    /** One saved analysis of a game (null when it's gone), to show instead of the newest. */
    getReview(gameId: string, reviewId: string): Promise<GameReview | null>;
    save(input: SaveGameInput): Promise<SavedGame>;
    remove(id: string): Promise<void>;
    importPgn(input: ImportPgnInput): Promise<ImportedGame>;
    /**
     * Registers a pending-save flush (the game autosave, a repertoire chapter draft). The window
     * runs every registered one before it closes (quit, or the close button) and waits for them —
     * a bounded time — so the last edits are stored. Each resolves with whether its edits are saved
     * (any false: closing asks first).
     */
    onFlushRequest(handler: () => Promise<boolean>): Unsubscribe;
  };
  databases: {
    list(): Promise<InstalledDatabase[]>;
    download(sourceId: string): Promise<InstalledDatabase>;
    samplePuzzle(input: PuzzleSampleInput): Promise<PuzzleSample>;
    remove(id: string): Promise<void>;
    /** Stops a running download (its partial file stays, so downloading again resumes). */
    cancelDownload(sourceId: string): Promise<void>;
    /** The latest progress of every running download. */
    activeDownloads(): Promise<DatabaseDownloadProgress[]>;
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
    /** Several settings in one write (stored together, or not at all). */
    patch(patch: Partial<AppSettings>): Promise<void>;
  };
  commentary: {
    getOpenRouterConfig(): Promise<OpenRouterConfigSummary>;
    setOpenRouterConfig(input: SetOpenRouterConfigInput): Promise<OpenRouterConfigSummary>;
    generate(input: GenerateCommentaryInput): Promise<GenerateCommentaryResult>;
  };
  /** Optional usage analytics (docs/telemetry.md); the renderer only reports a few interactions. */
  telemetry: {
    status(): Promise<TelemetryStatus>;
    /**
     * Fire-and-forget: main validates and may ignore it (a repeat). Resolves whether collection is
     * on, so the renderer doesn't spend its throttles on reports nobody records.
     */
    track(event: TelemetryRendererEvent): Promise<boolean>;
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
    /** Every change of the in-app update state (checks, progress, errors, settings). */
    onUpdateState(callback: (state: UpdateState) => void): Unsubscribe;
    /** Lichess account, seek, challenge, game and import events (main/lichess). */
    onLichessEvent(callback: (event: LichessEvent) => void): Unsubscribe;
  };

  /**
   * Lichess account, play and game import (main/lichess). The token never crosses IPC. Actions
   * reject with a readable message when Lichess refuses them (rate limit, not your turn, …).
   */
  lichess: {
    status(): Promise<LichessStatus>;
    /** Opens lichess.org in the browser to sign in; resolves once approved, cancelled or timed out. */
    connect(): Promise<LichessStatus>;
    cancelConnect(): Promise<void>;
    /** Revokes the token on lichess.org and forgets it; optionally deletes the imported games. */
    disconnect(options: { removeGames: boolean }): Promise<LichessStatus>;
    /** Imports new finished games (the last year on the first import); progress arrives as `sync` events. */
    syncGames(): Promise<LichessSyncResult>;
    /** Starts a lobby seek; pairing arrives as a `gameStart` event. Replaces a running seek. */
    seek(input: LichessSeekInput): Promise<void>;
    cancelSeek(): Promise<void>;
    challenge(input: LichessChallengeInput): Promise<LichessChallenge>;
    challengeAi(input: LichessAiChallengeInput): Promise<{ gameId: string }>;
    acceptChallenge(challengeId: string): Promise<void>;
    declineChallenge(challengeId: string): Promise<void>;
    cancelChallenge(challengeId: string): Promise<void>;
    /** Challenges waiting for an answer (incoming and your own), e.g. after a restart. */
    challenges(): Promise<LichessChallenge[]>;
    /** Ids of your games in progress (to resume one after a restart). */
    ongoingGames(): Promise<string[]>;
    /** Streams a game (`gameFull`, then `gameState` events) until it ends or `unwatchGame`. */
    watchGame(gameId: string): Promise<void>;
    unwatchGame(gameId: string): Promise<void>;
    move(gameId: string, uci: string): Promise<void>;
    resign(gameId: string): Promise<void>;
    abort(gameId: string): Promise<void>;
    /** Offers a draw, or accepts the opponent's offer. */
    offerDraw(gameId: string): Promise<void>;
    declineDraw(gameId: string): Promise<void>;
  };

  /**
   * Repertoires (main/repertoire): study chapters, repertoire-wide decisions, and practice graded
   * by the main process. Mutations carrying `expectedRevision` reject when the repertoire changed
   * since the caller's draft. Practice calls submit moves/actions, never a success flag.
   */
  repertoires: {
    list(filters?: RepertoireListFilters): Promise<RepertoireSummary[]>;
    get(id: string): Promise<RepertoireDetail>;
    /** One chapter's full content (tree, node metadata, headers); details carry only summaries. */
    getChapter(input: { repertoireId: string; chapterId: string }): Promise<RepertoireChapter>;
    /** The stored decision at a position, or null when the repertoire has none there yet. */
    getDecision(input: {
      repertoireId: string;
      positionKey: string;
    }): Promise<RepertoireDecision | null>;
    create(input: CreateRepertoireInput): Promise<RepertoireDetail>;
    updateMetadata(input: UpdateRepertoireMetadataInput): Promise<RepertoireDetail>;
    /** Saves one chapter and reconciles decisions/index/progress in the same transaction. */
    saveChapter(input: SaveChapterInput): Promise<ChapterSaveResult>;
    updateDecision(input: UpdateDecisionInput): Promise<DecisionSaveResult>;
    removeChapter(input: RemoveChapterInput): Promise<RepertoireChangeResult>;
    /** Copies content and decisions; progress starts fresh. */
    duplicate(input: DuplicateRepertoireInput): Promise<RepertoireDetail>;
    /** Reversible: archived repertoires contribute no due cards. */
    archive(input: ArchiveRepertoireInput): Promise<RepertoireChangeResult>;
    remove(input: RemoveRepertoireInput): Promise<void>;
    /** Parses every game of the PGN (pasted text, or a file the user picked) into a pending job. */
    previewImport(input: PreviewImportInput): Promise<ImportPreview>;
    /** Commits the selected games of a previewed job as chapters, atomically. */
    commitImport(input: ImportCommitInput): Promise<ImportResult>;
    cancelImport(jobId: string): Promise<void>;
    /** Multi-game PGN; the main process offers a save dialog and also returns the text. */
    export(input: ExportInput): Promise<ExportResult>;
    startPractice(input: StartPracticeInput): Promise<PracticeSessionSnapshot>;
    resumePractice(sessionId: string): Promise<PracticeSessionSnapshot>;
    /** Hint, reveal or skip; persisted before the result is shown. */
    recordPracticeAction(input: PracticeActionInput): Promise<PracticeActionResult>;
    /** A submitted move; deduplicated by `attemptId`. */
    recordAttempt(input: RecordAttemptInput): Promise<AttemptResult>;
    endPractice(sessionId: string): Promise<PracticeSummary>;
    saveWorkspace(input: SaveWorkspaceInput): Promise<void>;
    /** Due decisions across active repertoires, and where to continue studying (Home card). */
    getDueSummary(): Promise<RepertoireDueSummary>;
    onChanged(callback: (event: RepertoireChangedEvent) => void): Unsubscribe;
  };

  /** In-app updates of Chaturanga itself (main/updater.ts). */
  updates: {
    getState(): Promise<UpdateState>;
    /** Checks now (no-op while a check or download runs, or an update waits for a restart). */
    check(): Promise<UpdateState>;
    /** Downloads the available update (automatic-update builds with background downloads off). */
    download(): Promise<UpdateState>;
    /** Restarts into the downloaded update. False when none is ready. */
    install(): Promise<boolean>;
    /** Manual-download builds: opens the installer (or release page) in the browser. */
    openDownload(): Promise<boolean>;
  };

  /** Asset manager bridge — engine + Maia weight downloads (main/engine/asset-manager.ts). */
  assets: {
    /** Installs the latest release of one asset. */
    download(assetId: EngineAssetId): Promise<EngineAssetActionResult>;
    /** Installs every asset that is missing and downloadable on this platform. */
    downloadAll(): Promise<EngineAssetDownloadSummary>;
    remove(assetId: EngineAssetId): Promise<void>;
    setCustomPath(assetId: EngineAssetId, customPath: string): Promise<void>;
    /**
     * Installed state plus the latest upstream version and download size per asset. Makes no
     * network request unless `refresh` is set (then GitHub is asked, at most once a minute).
     */
    status(options?: { refresh?: boolean }): Promise<EngineAssetStatusMap>;
    /** Explicit "Check for updates": refreshes the latest GitHub releases and returns the status. */
    checkForUpdates(): Promise<EngineAssetStatusMap>;
    /** Replaces an installed asset with the latest release (user-triggered; never automatic). */
    update(assetId: EngineAssetId): Promise<EngineAssetActionResult>;
  };

  /** Per-asset download / verify / install / ready / error steps of a running install. */
  onAssetProgress(callback: (event: AssetProgressEvent) => void): Unsubscribe;
  /**
   * Fired when asset status may have changed without a progress event: the background release
   * check at startup finished, a check for updates ran, or an asset was installed/removed.
   * Re-read `assets.status()`.
   */
  onAssetStatusChanged(callback: () => void): Unsubscribe;
  /**
   * The engine list changed in the main process (assets installed/removed, startup registry
   * sync). Re-fetch `engines.list()`.
   */
  onEnginesChanged(callback: () => void): Unsubscribe;
};

export type EngineAssetId = "stockfish" | "lc0" | "maia-1100" | "maia-1300" | "maia-1500" | "maia-1700" | "maia-1900";

export type EngineAssetActionResult = { ok: true } | { ok: false; error: string };

export type EngineAssetDownloadSummary = {
  succeeded: EngineAssetId[];
  failed: { id: EngineAssetId; reason: string }[];
};

/** One entry of `assets.status()`. */
export type EngineAssetStatus = {
  id: EngineAssetId;
  /** "custom": the user pointed the asset at their own file. */
  state: "missing" | "installed" | "custom";
  installedPath: string | null;
  customPath: string | null;
  /** Bytes on disk (0 when missing). */
  sizeBytes: number;
  installedAt: string | null;
  /** Installed version: release tag (`sf_19`, `v0.32.1`) or `v1.0` for Maia; older installs may show a bare version (`17.1`). */
  installedVersion: string | null;
  /** Newest known version (release tag); null when this platform needs a manual install. */
  latestVersion: string | null;
  /** A managed install whose version differs from the latest GitHub release. */
  updateAvailable: boolean;
  /** Size of what a download/update would fetch, from the GitHub release (or fallback list). */
  downloadSizeBytes: number | null;
  /** "github": live/cached release lookup; "fallback": bundled last known-good; "fixed": Maia weights. */
  latestSource: "github" | "fallback" | "fixed" | null;
  /** False when the platform has no download (Lc0 on macOS / Linux): show `installInstructions`. */
  autoDownload: boolean;
  installInstructions: string | null;
  /** When the release was last fetched from GitHub (ISO). */
  checkedAt: string | null;
  /** Why the latest lookup failed (e.g. rate limited) while a cached or fallback answer is shown. */
  checkError: string | null;
};

export type EngineAssetStatusMap = Record<EngineAssetId, EngineAssetStatus>;

export type AssetProgressEvent =
  | { type: "download"; assetId: EngineAssetId; bytesReceived: number; bytesTotal: number }
  | { type: "verify"; assetId: EngineAssetId }
  | { type: "install"; assetId: EngineAssetId }
  | { type: "ready"; assetId: EngineAssetId }
  | { type: "error"; assetId: EngineAssetId; message: string };

declare global {
  interface Window {
    chaturanga?: ChaturangaApi;
  }
}
