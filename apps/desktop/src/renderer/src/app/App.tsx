import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BookOpen,
  Bot,
  ChevronDown,
  CheckCircle2,
  Cpu,
  Database,
  Download,
  FileSearch,
  FolderOpen,
  Home,
  Library,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Puzzle,
  Repeat2,
  RotateCcw,
  Settings,
  XCircle,
  Swords,
  Upload
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { hasDesktopApi, isElectronMac } from "@/lib/environment";
import { BoardView } from "../features/board/BoardView";
import { MoveList } from "../features/game/MoveList";
import { PgnImportDialog } from "../features/game/PgnImportDialog";
import { EngineSettingsPage } from "../features/settings/EngineSettingsDialog";
import { EngineGameControls, EngineGamePage } from "../features/analysis/EngineGameControls";
import { EngineStatusPanel } from "../features/analysis/EngineStatusPanel";
import { GameReviewPanel } from "../features/review/GameReviewPanel";
import { PromotionDialog } from "../features/board/PromotionDialog";
import { RecentGames } from "../features/game/RecentGames";
import { DatabasePage } from "../features/database/DatabasePage";
import { PuzzlePage, type PuzzleSessionConfig } from "../features/puzzles/PuzzlePage";
import { EngineMatchActions } from "../features/analysis/EngineMatchActions";
import { currentLineUcis } from "../features/analysis/engine-game-helpers";
import {
  canRunInBrowser,
  startBrowserAnalysis,
  startBrowserEngineGame,
  stopBrowserEngine
} from "../engine/browser-stockfish";
import { useAnalysisStore } from "../stores/analysis-store";
import { useGameStore } from "../stores/game-store";
import { usePuzzleStore } from "../stores/puzzle-store";
import { useReviewStore } from "../stores/review-store";
import {
  useEnginesQuery,
  useSamplePuzzleMutation,
  useSaveGameMutation,
  useSettingsQuery
} from "../queries/api";
import { statusForFen } from "@chaturanga/shared/chess/position";
import { createGameFromFen } from "@chaturanga/shared/chess/pgn";
import { formatEngineScore, reviewLabel } from "@chaturanga/shared/chess/review";
import type { PuzzleSample, PuzzleSampleInput } from "@chaturanga/shared/types/database";
import { defaultSettings } from "@chaturanga/shared/types/settings";
import { playSound, type SoundKind } from "../sounds/sounds";
import productIcon from "../assets/product-icons/staunty-knight-white.svg";

type SideTab = "notation" | "review" | "engine" | "library";
type AppView = "home" | "game" | "settings" | "engine-game" | "puzzles" | "databases";

const sideTabs: {
  id: SideTab;
  label: string;
  description: string;
  icon: typeof BookOpen;
}[] = [
  { id: "notation", label: "Moves", description: "Notation", icon: BookOpen },
  { id: "review", label: "Review", description: "Game insights", icon: BarChart3 },
  { id: "engine", label: "Engine", description: "Live analysis", icon: Cpu },
  { id: "library", label: "Library", description: "Saved games", icon: Library }
];

export function App() {
  const [importOpen, setImportOpen] = useState(false);
  const [engineControlsOpen, setEngineControlsOpen] = useState(false);
  const [sideTab, setSideTab] = useState<SideTab>("notation");
  const [appView, setAppView] = useState<AppView>("home");
  const [focusMode, setFocusMode] = useState(false);
  const [actionRailOpen, setActionRailOpen] = useState(true);
  const [activePuzzleConfig, setActivePuzzleConfig] = useState<PuzzleSessionConfig | null>(null);
  const [puzzleHistoryIds, setPuzzleHistoryIds] = useState<string[]>([]);
  const desktopApiAvailable = hasDesktopApi();
  const windowControlsVisible = isElectronMac();
  const game = useGameStore();
  const engines = useEnginesQuery();
  const nextPuzzle = useSamplePuzzleMutation();
  const saveGame = useSaveGameMutation();
  const settingsQuery = useSettingsQuery();
  const settings = { ...defaultSettings, ...(settingsQuery.data ?? {}) };
  const analysisError = useAnalysisStore((s) => s.error);
  const analysisStatus = useAnalysisStore((s) => s.status);
  const latestInfo = useAnalysisStore((s) => s.latestInfo);
  const bestMove = useAnalysisStore((s) => s.bestMove);
  const activePuzzle = usePuzzleStore((s) => s.activePuzzle);
  const puzzleSolutionIndex = usePuzzleStore((s) => s.solutionIndex);
  const puzzleFeedbackKind = usePuzzleStore((s) => s.feedbackKind);
  const puzzleFeedback = usePuzzleStore((s) => s.feedback);
  const puzzleLastExpectedMove = usePuzzleStore((s) => s.lastExpectedMove);
  const status = useMemo(() => statusForFen(game.currentFen), [game.currentFen]);
  const headlineEnded = Boolean(game.gameOutcome) || status.isEnd;
  const headlineResult = game.gameOutcome?.result ?? status.result;
  const lastNodeIdRef = useRef<string | null>(null);
  const lastNodeCountRef = useRef<number>(0);
  const review = useReviewStore((state) => state.review);
  const partialMoves = useReviewStore((state) => state.partialMoves);
  const currentMoveReview = useMemo(() => {
    const moves = review?.moves ?? partialMoves;
    return moves.find((move) => move.nodeId === game.currentNodeId) ?? null;
  }, [game.currentNodeId, partialMoves, review]);
  const engineScore = latestInfo?.score ? formatEngineScore(latestInfo.score) : "—";
  const statusMessage =
    (game.mode === "puzzle" ? puzzleFeedback : null) ||
    game.matchFeedback ||
    game.lastError ||
    analysisError ||
    "Ready";
  const positionLabel = headlineEnded
    ? `Game over ${headlineResult}${
        game.gameOutcome?.termination ? ` (${game.gameOutcome.termination})` : ""
      }`
    : `${status.turn} to move`;
  const viewTitle =
    appView === "home"
      ? "Home"
      : appView === "settings"
        ? "Settings"
        : appView === "engine-game"
          ? "Play engine"
          : appView === "puzzles"
            ? "Puzzles"
            : appView === "databases"
              ? "Databases"
              : statusMessage;
  const defaultEngineId = useMemo(
    () => engines.data?.find((engine) => engine.isDefault)?.id ?? engines.data?.[0]?.id ?? null,
    [engines.data]
  );

  useEffect(() => {
    function isEditableTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      if (target instanceof HTMLInputElement) return true;
      if (target instanceof HTMLTextAreaElement) return true;
      if (target instanceof HTMLSelectElement) return true;
      if (target.isContentEditable) return true;
      return false;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target) || isEditableTarget(document.activeElement)) return;

      const gameStore = useGameStore.getState();
      switch (event.key) {
        case "ArrowLeft":
          event.preventDefault();
          gameStore.undo();
          break;
        case "ArrowRight":
          event.preventDefault();
          gameStore.redo();
          break;
        case "Home": {
          event.preventDefault();
          gameStore.goToNode("root");
          break;
        }
        case "End": {
          event.preventDefault();
          let nodeId = gameStore.currentNodeId;
          const tree = gameStore.moveTree;
          while (true) {
            const node = tree.find((item) => item.id === nodeId);
            if (!node?.children[0]) break;
            nodeId = node.children[0];
          }
          if (nodeId !== gameStore.currentNodeId) gameStore.goToNode(nodeId);
          break;
        }
        default:
          return;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!window.chaturanga?.events) return;
    const unsubInfo = window.chaturanga.events.onEngineInfo((info) =>
      useAnalysisStore.getState().setInfo(info)
    );
    const unsubBestMove = window.chaturanga.events.onEngineBestMove((bestMove) => {
      useAnalysisStore.getState().setBestMove(bestMove.move);
      const gameState = useGameStore.getState();
      if (gameState.mode !== "engine" || gameState.gameOutcome) return;
      const ok = gameState.makeUciMove(bestMove.move);
      if (!ok) useAnalysisStore.getState().setError(`Illegal engine move: ${bestMove.move}`);
    });
    const unsubError = window.chaturanga.events.onEngineError((error) =>
      useAnalysisStore.getState().setError(error.message)
    );
    const unsubReviewProgress = window.chaturanga.events.onReviewProgress((progress) => {
      const store = useReviewStore.getState();
      if (store.reviewId && progress.reviewId !== store.reviewId) return;
      store.setProgress(progress);
    });
    const unsubReviewMoveCompleted = window.chaturanga.events.onReviewMoveCompleted((event) => {
      const store = useReviewStore.getState();
      if (store.reviewId && event.reviewId !== store.reviewId) return;
      store.appendPartialMove(event.move);
    });
    const unsubReviewCompleted = window.chaturanga.events.onReviewCompleted((event) => {
      const store = useReviewStore.getState();
      if (store.reviewId && event.reviewId !== store.reviewId) return;
      store.setReview(event.review);
    });
    const unsubReviewFailed = window.chaturanga.events.onReviewFailed((event) => {
      const store = useReviewStore.getState();
      if (store.reviewId && event.reviewId !== store.reviewId) return;
      if (event.message === "Review cancelled") store.markCancelled();
      else store.setError(event.message);
    });
    return () => {
      unsubInfo();
      unsubBestMove();
      unsubError();
      unsubReviewProgress();
      unsubReviewMoveCompleted();
      unsubReviewCompleted();
      unsubReviewFailed();
    };
  }, []);

  const reviewStatus = useReviewStore((state) => state.status);
  const reviewProgressNodeId = useReviewStore((state) =>
    state.status === "running" ? state.progress?.nodeId ?? null : null
  );
  const lastAutoFollowedRef = useRef<string | null>(null);

  useEffect(() => {
    if (reviewStatus !== "running") {
      lastAutoFollowedRef.current = null;
      return;
    }
    if (!reviewProgressNodeId) return;
    const gameState = useGameStore.getState();
    if (reviewProgressNodeId === gameState.currentNodeId) {
      lastAutoFollowedRef.current = reviewProgressNodeId;
      return;
    }
    if (!gameState.moveTree.some((node) => node.id === reviewProgressNodeId)) return;
    if (
      lastAutoFollowedRef.current !== null &&
      lastAutoFollowedRef.current !== gameState.currentNodeId
    ) {
      return;
    }
    lastAutoFollowedRef.current = reviewProgressNodeId;
    gameState.goToNode(reviewProgressNodeId);
  }, [reviewProgressNodeId, reviewStatus]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const gameState = useGameStore.getState();
      // Puzzle practice is ephemeral: never persist it as a "saved game" / recent entry.
      if (gameState.mode === "puzzle" && usePuzzleStore.getState().activePuzzle) {
        return;
      }
      const session = gameState.toSession();
      const review = useReviewStore.getState().review;
      if (session.moveTree.length > 1 || session.id) {
        saveGame.mutate(
          {
            id: session.id,
            source: session.source,
            headers: {
              ...session.headers,
              result: useGameStore.getState().gameOutcome?.result ?? status.result
            },
            rootFen: session.rootFen,
            currentFen: session.currentFen,
            pgn: session.pgn,
            moveTree: session.moveTree,
            review
          },
          {
            onSuccess: (saved) => useGameStore.getState().setGameId(saved.id)
          }
        );
      }
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [
    game.currentFen,
    game.moveTree,
    game.mode,
    review,
    saveGame,
    status.result,
    game.gameOutcome,
    activePuzzle
  ]);

  useEffect(() => {
    if (!game.gameOutcome) return;
    void window.chaturanga?.engines.stop();
    useAnalysisStore.getState().reset();
  }, [game.gameOutcome]);

  useEffect(() => {
    if (
      game.mode !== "engine" ||
      !game.engineClock ||
      !game.engineClockLive ||
      game.gameOutcome
    )
      return;
    const tick = window.setInterval(() => {
      const store = useGameStore.getState();
      const live = store.engineClockLive;
      if (!live || store.gameOutcome) return;
      const elapsed = Date.now() - live.turnStartedAt;
      const budget = live.sideToMove === "white" ? live.whiteMs : live.blackMs;
      if (budget - elapsed <= 0) {
        store.resolveTimeout(live.sideToMove);
      }
    }, 200);
    return () => window.clearInterval(tick);
  }, [
    game.mode,
    game.engineClock,
    game.engineClockLive,
    game.gameOutcome,
    game.currentFen
  ]);

  useEffect(() => {
    if (
      game.mode !== "engine" ||
      !game.engineSide ||
      status.turn !== game.engineSide ||
      status.isEnd ||
      game.gameOutcome
    )
      return;
    const engineId = useAnalysisStore.getState().activeEngineId;
    if (!engineId) return;
    const moves = currentLineUcis(game.moveTree, game.currentNodeId);
    useAnalysisStore.getState().setStatus("thinking");
    const clock = useGameStore.getState().getClockForEngineGo();
    if (!window.chaturanga) {
      if (!canRunInBrowser(engineId)) return;
      void startBrowserEngineGame(
        {
          engineId,
          side: game.engineSide,
          fen: game.rootFen,
          moves,
          moveTimeMs: clock ? null : game.moveTimeMs,
          depth: clock ? null : game.depth,
          clock
        },
        (info) => useAnalysisStore.getState().setInfo(info)
      )
        .then((bestMove) => {
          if (!bestMove) return;
          useAnalysisStore.getState().setBestMove(bestMove.move);
          const ok = useGameStore.getState().makeUciMove(bestMove.move);
          if (!ok) useAnalysisStore.getState().setError(`Illegal engine move: ${bestMove.move}`);
        })
        .catch((error: unknown) => {
          useAnalysisStore.getState().setStatus("error");
          useAnalysisStore
            .getState()
            .setError(error instanceof Error ? error.message : String(error));
        });
      return;
    }
    void window.chaturanga.engines
      .startGame({
        engineId,
        side: game.engineSide,
        fen: game.rootFen,
        moves,
        moveTimeMs: clock ? null : game.moveTimeMs,
        depth: clock ? null : game.depth,
        clock
      })
      .catch((error: unknown) => {
        useAnalysisStore.getState().setStatus("error");
        useAnalysisStore
          .getState()
          .setError(error instanceof Error ? error.message : String(error));
      });
  }, [
    game.currentFen,
    game.depth,
    game.engineClock,
    game.engineClockLive,
    game.engineSide,
    game.gameOutcome,
    game.mode,
    game.moveTimeMs,
    game.moveTree,
    game.currentNodeId,
    game.rootFen,
    status.isEnd,
    status.turn
  ]);

  useEffect(() => {
    if (game.mode !== "analysis" || status.isEnd || game.gameOutcome) return;
    const engineId = useAnalysisStore.getState().activeEngineId ?? defaultEngineId;
    if (!engineId) {
      useAnalysisStore.getState().setStatus("idle");
      useAnalysisStore.getState().setError("Configure an engine to start live analysis.");
      return;
    }
    const moves = currentLineUcis(game.moveTree, game.currentNodeId);
    useAnalysisStore.getState().setActiveEngine(engineId);
    useAnalysisStore.getState().setError(null);
    useAnalysisStore.getState().setStatus("thinking");
    if (!window.chaturanga) {
      if (!canRunInBrowser(engineId)) {
        useAnalysisStore.getState().setStatus("error");
        useAnalysisStore.getState().setError("This engine is only available in the desktop app.");
        return;
      }
      void startBrowserAnalysis(
        {
          engineId,
          fen: game.rootFen,
          moves,
          multipv: 3
        },
        (info) => useAnalysisStore.getState().setInfo(info)
      ).catch((error: unknown) => {
        useAnalysisStore.getState().setStatus("error");
        useAnalysisStore
          .getState()
          .setError(error instanceof Error ? error.message : String(error));
      });
      return () => stopBrowserEngine();
    }
    void window.chaturanga.engines
      .startAnalysis({
        engineId,
        fen: game.rootFen,
        moves,
        multipv: 3
      })
      .catch((error: unknown) => {
        useAnalysisStore.getState().setStatus("error");
        useAnalysisStore
          .getState()
          .setError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      void window.chaturanga?.engines.stop();
    };
  }, [
    defaultEngineId,
    game.currentFen,
    game.currentNodeId,
    game.gameOutcome,
    game.mode,
    game.moveTree,
    game.rootFen,
    status.isEnd
  ]);

  useEffect(() => {
    if (game.mode !== "puzzle" || !activePuzzle) return;
    if (puzzleSolutionIndex <= 0 || puzzleSolutionIndex >= activePuzzle.solutionMoves.length) return;
    if (puzzleSolutionIndex % 2 === 0) return;
    const reply = activePuzzle.solutionMoves[puzzleSolutionIndex];
    const timeout = window.setTimeout(() => {
      const moved = useGameStore.getState().makeUciMove(reply);
      if (!moved) {
        usePuzzleStore.getState().markWrongMove({ played: "Auto reply failed", expected: reply });
        return;
      }
      const nextIndex = usePuzzleStore.getState().solutionIndex + 1;
      if (nextIndex >= activePuzzle.solutionMoves.length) {
        usePuzzleStore.getState().markComplete();
      } else {
        usePuzzleStore.getState().advanceSolution(1, "Good. Find the next move.");
      }
    }, 320);
    return () => window.clearTimeout(timeout);
  }, [activePuzzle, game.currentFen, game.mode, puzzleSolutionIndex]);

  useEffect(() => {
    const prevId = lastNodeIdRef.current;
    const currId = game.currentNodeId;
    lastNodeIdRef.current = currId;
    lastNodeCountRef.current = game.moveTree.length;

    if (!settings.soundEnabled) return;
    if (prevId === null || prevId === currId) return;

    const currNode = game.moveTree.find((item) => item.id === currId);
    const prevNode = game.moveTree.find((item) => item.id === prevId);

    let movedNode: typeof currNode | undefined;
    if (currNode && currNode.parentId === prevId) {
      movedNode = currNode;
    } else if (prevNode && prevNode.parentId === currId) {
      movedNode = prevNode;
    } else {
      movedNode = latestNodeOnPath(game.moveTree, prevId, currId) ?? undefined;
    }
    if (!movedNode) return;

    const kind = pickSound({
      san: movedNode.san ?? "",
      result: status.result,
      isEnd: status.isEnd,
      engineSide: game.engineSide,
      orientation: game.orientation
    });
    playSound(kind, settings.soundVolume);
  }, [
    game.currentNodeId,
    game.moveTree,
    game.engineSide,
    game.orientation,
    settings.soundEnabled,
    settings.soundVolume,
    status.isEnd,
    status.result
  ]);

  async function exportPgn() {
    if (!desktopApiAvailable || !window.chaturanga) return;
    const session = game.toSession();
    await window.chaturanga.files.savePgnFile("chaturanga-game.pgn", session.pgn);
  }

  async function importPgnFile() {
    if (!desktopApiAvailable || !window.chaturanga) return;
    const file = await window.chaturanga.files.openPgnFile();
    if (!file) return;
    const imported = await window.chaturanga.games.importPgn({
      pgn: file.contents
    });
    await window.chaturanga.engines.stop();
    useAnalysisStore.getState().reset();
    useReviewStore.getState().reset();
    usePuzzleStore.getState().reset();
    setActivePuzzleConfig(null);
    setPuzzleHistoryIds([]);
    game.loadGame(imported.game);
    game.setMode("freeplay");
    setSideTab("notation");
    setAppView("game");
  }

  function startNewGame() {
    void window.chaturanga?.engines.stop();
    useAnalysisStore.getState().reset();
    useReviewStore.getState().reset();
    usePuzzleStore.getState().reset();
    setActivePuzzleConfig(null);
    setPuzzleHistoryIds([]);
    game.reset();
    setAppView("game");
  }

  function startLiveAnalysis() {
    if (!desktopApiAvailable) return;
    useReviewStore.getState().reset();
    useAnalysisStore.getState().reset();
    usePuzzleStore.getState().reset();
    setActivePuzzleConfig(null);
    setPuzzleHistoryIds([]);
    game.setMode("analysis");
    game.setGameSource("analysis");
    game.setEngineSide(null);
    game.clearEngineMatchExtras();
    if (defaultEngineId) useAnalysisStore.getState().setActiveEngine(defaultEngineId);
    setFocusMode(false);
    setSideTab("engine");
    setAppView("game");
  }

  function openGameReview() {
    if (!desktopApiAvailable) return;
    void window.chaturanga?.engines.stop();
    useAnalysisStore.getState().reset();
    usePuzzleStore.getState().reset();
    setActivePuzzleConfig(null);
    setPuzzleHistoryIds([]);
    game.setMode("freeplay");
    game.setEngineSide(null);
    game.clearEngineMatchExtras();
    setFocusMode(false);
    setSideTab("review");
    setAppView("game");
  }

  function openEngineGamePage() {
    if (!desktopApiAvailable) return;
    void window.chaturanga?.engines.stop();
    useAnalysisStore.getState().reset();
    usePuzzleStore.getState().reset();
    setActivePuzzleConfig(null);
    setPuzzleHistoryIds([]);
    setFocusMode(false);
    setAppView("engine-game");
  }

  function openPuzzlesPage() {
    if (!desktopApiAvailable) return;
    void window.chaturanga?.engines.stop();
    useAnalysisStore.getState().reset();
    game.setMode("puzzle");
    game.setGameSource("puzzle");
    setFocusMode(false);
    setAppView("puzzles");
  }

  function openDatabasesPage() {
    if (!desktopApiAvailable) return;
    void window.chaturanga?.engines.stop();
    useAnalysisStore.getState().reset();
    setFocusMode(false);
    setAppView("databases");
  }

  function playEngineFromCurrentPuzzlePosition() {
    if (!desktopApiAvailable) return;
    const engine = engines.data?.find((item) => item.id === defaultEngineId) ?? engines.data?.[0];
    if (!engine) {
      setAppView("settings");
      return;
    }
    const fen = useGameStore.getState().currentFen;
    const currentStatus = statusForFen(fen);
    if (currentStatus.isEnd) {
      useGameStore.getState().setMatchFeedback("This puzzle position is already finished.");
      return;
    }

    const engineSide = currentStatus.turn;
    const humanSide = engineSide === "white" ? "black" : "white";
    void window.chaturanga?.engines.stop();
    useAnalysisStore.getState().reset();
    useReviewStore.getState().reset();
    usePuzzleStore.getState().reset();
    setActivePuzzleConfig(null);
    setPuzzleHistoryIds([]);
    game.loadGame(
      createGameFromFen({
        fen,
        source: "engine-game",
        headers: {
          event: "Puzzle continuation",
          site: "?",
          result: "*",
          white: engineSide === "white" ? engine.name : "You",
          black: engineSide === "black" ? engine.name : "You",
          orientationHint: humanSide
        }
      })
    );
    game.setOrientation(humanSide);
    game.setMode("engine");
    game.setEngineSide(engineSide);
    game.setEngineMatchClock(null);
    game.clearEngineMatchExtras();
    game.setMatchFeedback("Playing engine from puzzle position.");
    useAnalysisStore.getState().setActiveEngine(engine.id);
    useAnalysisStore.getState().setStatus("ready");
    useAnalysisStore.getState().setError(null);
    setFocusMode(false);
    setSideTab("notation");
    setAppView("game");
  }

  function startPuzzle(puzzle: PuzzleSample, config?: PuzzleSessionConfig) {
    void window.chaturanga?.engines.stop();
    useAnalysisStore.getState().reset();
    useReviewStore.getState().reset();
    usePuzzleStore.getState().setActivePuzzle(puzzle);
    if (config) {
      setActivePuzzleConfig(config);
      setPuzzleHistoryIds([puzzle.id]);
    }
    game.loadGame(
      createGameFromFen({
        fen: puzzle.initialFen,
        source: "puzzle",
        headers: {
          event: puzzle.sourceName,
          site: puzzle.gameUrl ?? "?",
          white: "White",
          black: "Black",
          result: "*",
          orientationHint: puzzle.sideToMove
        }
      })
    );
    game.setMode("puzzle");
    game.setGameSource("puzzle");
    game.setOrientation(puzzle.sideToMove);
    setSideTab("notation");
    setAppView("game");
  }

  function loadNextPuzzle() {
    if (!activePuzzleConfig?.databaseId) {
      setAppView("puzzles");
      return;
    }
    nextPuzzle.mutate(puzzleInputFromConfig(activePuzzleConfig, puzzleHistoryIds), {
      onSuccess: (puzzle) => {
        setPuzzleHistoryIds((ids) => [...ids, puzzle.id]);
        startPuzzle(puzzle);
      }
    });
  }

  return (
    <main className="h-screen bg-[#111315] text-[#f4f1ea]">
      <section
        className={cn(
          "relative grid h-screen overflow-hidden bg-[#111315] transition-[grid-template-columns] duration-200 ease-out",
          actionRailOpen ? "[--sidebar-width:clamp(224px,18vw,286px)]" : "[--sidebar-width:0px]",
          appView !== "game"
            ? "[--inspector-width:0px] [--board-size:0px] grid-cols-[var(--sidebar-width)_minmax(0,1fr)] grid-rows-[52px_minmax(0,1fr)]"
            : focusMode
            ? "[--inspector-width:0px] [--board-size:min(1120px,calc(100vh_-_132px),calc(100vw_-_var(--sidebar-width)_-_72px))] grid-cols-[var(--sidebar-width)_minmax(0,1fr)] grid-rows-[52px_minmax(0,1fr)]"
            : "[--inspector-width:clamp(340px,23vw,430px)] [--board-size:min(920px,calc(100vh_-_148px),calc(100vw_-_var(--sidebar-width)_-_var(--inspector-width)_-_72px))] grid-cols-[var(--sidebar-width)_minmax(0,1fr)_var(--inspector-width)] grid-rows-[52px_minmax(0,1fr)]"
        )}
      >
        {actionRailOpen ? (
        <TooltipProvider>
          <nav
            className={cn(
              "sticky top-0 z-20 col-start-1 row-start-1 row-span-full flex min-h-screen w-[var(--sidebar-width)] flex-col justify-between gap-3.5 overflow-hidden border-r border-white/10 bg-[#161312] bg-gradient-to-b from-[#483c3a]/35 to-transparent px-2 pb-3 transition-[width,background-color] duration-200 ease-out",
              windowControlsVisible ? "pt-[58px]" : "pt-3",
              "px-3"
            )}
            aria-label="Application actions"
          >
            <TitlebarRailToggle
              expanded={actionRailOpen}
              className="absolute right-3 top-2.5"
              onClick={() => setActionRailOpen(false)}
            />
            <div className="grid min-w-0 content-start gap-1.5">
              <div className="grid min-h-[52px] min-w-0 items-center gap-2.5 [-webkit-app-region:drag]">
                <div className="flex min-w-0 items-center gap-3">
                  <img
                    className="h-10 w-10 shrink-0 rounded-[9px] border border-white/10 bg-[#101112] bg-gradient-to-br from-[#8fb66f]/30 to-transparent p-1.5 shadow-inner"
                    src={productIcon}
                    alt=""
                  />
                    <div className="grid min-w-0 gap-0.5">
                      <strong className="truncate text-[15px] leading-none text-[#f4f1ea]">
                        Chaturanga
                      </strong>
                      <span className="truncate text-xs capitalize text-[#a9adb4]">
                        {positionLabel}
                      </span>
                    </div>
                </div>
              </div>

              <Separator className="my-2.5 opacity-65" />

              <div className="grid min-w-0 gap-1.5">
                <SidebarCommand
                  expanded={actionRailOpen}
                  icon={Home}
                  label="Home"
                  active={appView === "home"}
                  onClick={() => setAppView("home")}
                />
                <p className="mx-2 mb-1 mt-1.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#727982]">
                  Game
                </p>
                <SidebarCommand
                  expanded={actionRailOpen}
                  icon={RotateCcw}
                  label="New game"
                  onClick={startNewGame}
                />
                <SidebarCommand
                  expanded={actionRailOpen}
                  icon={FileSearch}
                  label="Analyze"
                  active={game.mode === "analysis"}
                  onClick={startLiveAnalysis}
                />
                <SidebarCommand
                  expanded={actionRailOpen}
                  icon={BarChart3}
                  label="Game review"
                  active={appView === "game" && sideTab === "review"}
                  onClick={openGameReview}
                />
                <SidebarCommand
                  expanded={actionRailOpen}
                  icon={Swords}
                  label="Engine game"
                  active={appView === "engine-game"}
                  onClick={openEngineGamePage}
                />
                <SidebarCommand
                  expanded={actionRailOpen}
                  icon={Puzzle}
                  label="Puzzles"
                  active={appView === "puzzles"}
                  onClick={openPuzzlesPage}
                />
                <SidebarCommand
                  expanded={actionRailOpen}
                  icon={Database}
                  label="Databases"
                  active={appView === "databases"}
                  onClick={openDatabasesPage}
                />
                <SidebarCommand
                  expanded={actionRailOpen}
                  icon={Upload}
                  label="Import PGN"
                  onClick={importPgnFile}
                />
                <SidebarCommand
                  expanded={actionRailOpen}
                  icon={Download}
                  label="Export PGN"
                  onClick={exportPgn}
                />
              </div>
            </div>

            <div className="grid min-w-0 gap-1.5">
              <SidebarCommand
                expanded={actionRailOpen}
                icon={focusMode ? Minimize2 : Maximize2}
                label={focusMode ? "Show panels" : "Focus board"}
                active={focusMode}
                onClick={() => setFocusMode((value) => !value)}
              />
              <SidebarCommand
                expanded={actionRailOpen}
                icon={Settings}
                label="Settings"
                active={appView === "settings"}
                onClick={() => setAppView("settings")}
              />
            </div>
          </nav>
        </TooltipProvider>
        ) : null}

        <div
          className={cn(
            "z-30 row-start-1 flex h-[52px] min-w-0 items-center gap-2.5 border-b border-white/10 bg-[#111315]/95 px-5 text-sm text-[#a9adb4] [-webkit-app-region:drag]",
            actionRailOpen ? "col-[2/-1]" : "col-[1/-1]",
            !actionRailOpen && (windowControlsVisible ? "pl-[82px]" : "pl-3")
          )}
          aria-label="Game controls"
        >
          {!actionRailOpen ? (
            <TitlebarRailToggle
              expanded={actionRailOpen}
              onClick={() => setActionRailOpen(true)}
            />
          ) : null}
          {!actionRailOpen ? (
            <CollapsedBrandMenu
              focusMode={focusMode}
              onAnalyze={startLiveAnalysis}
              onEngineGame={openEngineGamePage}
              onExport={exportPgn}
              onFocusToggle={() => setFocusMode((value) => !value)}
              onHome={() => setAppView("home")}
              onImport={importPgnFile}
              onNewGame={startNewGame}
              onPuzzles={openPuzzlesPage}
              onDatabases={openDatabasesPage}
              onReview={openGameReview}
              onSettings={() => setAppView("settings")}
            />
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-[#a9adb4] [-webkit-app-region:no-drag]"
            disabled={appView === "home"}
            onClick={() => setAppView("home")}
            aria-label="Home"
          >
            <ArrowLeft />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-[#a9adb4] [-webkit-app-region:no-drag]"
            disabled={appView === "settings"}
            onClick={() => setAppView("settings")}
            aria-label="Settings"
          >
            <ArrowRight />
          </Button>
          <span className="min-w-[8ch] truncate font-semibold text-[#f4f1ea] [-webkit-app-region:no-drag]">
            {viewTitle}
          </span>
          {appView === "game" ? (
          <>
          {viewTitle !== statusMessage ? <span className="sr-only">{statusMessage}</span> : null}
          {bestMove || latestInfo?.pv?.[0] ? (
            <span className="inline-flex max-w-[260px] items-center gap-1.5 overflow-hidden rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 whitespace-nowrap [-webkit-app-region:no-drag]">
              Best <strong>{bestMove ?? latestInfo?.pv?.[0]}</strong>
            </span>
          ) : null}
          <EngineMatchActions />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto gap-2 [-webkit-app-region:no-drag]"
            onClick={() => game.flip()}
          >
            <Repeat2 size={15} />
            Flip
          </Button>
          </>
          ) : null}
        </div>

        <div className="col-start-2 row-start-2 grid min-h-0 min-w-0 justify-self-stretch border-0 bg-transparent">
          {!desktopApiAvailable ? <WebPreviewBanner /> : null}
          {appView === "home" ? (
            <HomePage
              desktopApiAvailable={desktopApiAvailable}
              onAnalyze={startLiveAnalysis}
              onDatabases={openDatabasesPage}
              onEngineGame={openEngineGamePage}
              onImportPgn={importPgnFile}
              onNewGame={startNewGame}
              onPuzzles={openPuzzlesPage}
              onReview={openGameReview}
            />
          ) : appView === "settings" ? (
            <EngineSettingsPage />
          ) : appView === "engine-game" ? (
            <EngineGamePage
              onOpenSettings={() => setAppView("settings")}
              onStart={() => {
                setSideTab("notation");
                setAppView("game");
              }}
            />
          ) : appView === "puzzles" ? (
            <PuzzlePage
              onDatabases={openDatabasesPage}
              onStart={(config, puzzle) => startPuzzle(puzzle, config)}
            />
          ) : appView === "databases" ? (
            <DatabasePage />
          ) : (
            <div className="grid min-h-0 justify-self-center px-5 py-6 content-center justify-items-center">
              <BoardView />
            </div>
          )}
        </div>

        {appView === "game" && !focusMode ? (
          <aside className="col-start-3 row-start-2 grid h-[calc(100vh-52px)] w-full min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-2.5 overflow-hidden p-3 pl-0">
            <div
              className="grid w-full min-w-0 grid-cols-4 items-center gap-1 rounded-[10px] border border-white/10 bg-[#121416]/95 bg-gradient-to-b from-white/[0.05] to-transparent p-1 shadow-[0_10px_28px_rgb(0_0_0/0.20)]"
              role="tablist"
              aria-label="Workspace panels"
            >
              {sideTabs.map((tab) => {
                const Icon = tab.icon;
                const selected = sideTab === tab.id;
                return (
                  <Button
                    key={tab.id}
                    type="button"
                    variant={selected ? "secondary" : "ghost"}
                    role="tab"
                    aria-selected={selected}
                    className="min-h-[42px] min-w-0 gap-1 overflow-hidden rounded-lg px-1 py-1.5 text-center text-[11px] font-bold [&_svg]:size-[14px]"
                    onClick={() => setSideTab(tab.id)}
                  >
                    <Icon size={17} className="shrink-0" />
                    <span className="min-w-0 truncate">{tab.label}</span>
                    <em className="sr-only">{tab.description}</em>
                  </Button>
                );
              })}
            </div>
            <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-2.5 overflow-y-auto overflow-x-hidden">
              <div className="grid w-full min-w-0 grid-cols-2 gap-1.5" aria-label="Position overview">
                <div className="grid min-w-0 gap-0.5 rounded-[7px] border border-[#2d3238] bg-[#191c20] px-2.5 py-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.04em] text-[#727982]">Turn</span>
                  <strong className="truncate text-[13px] capitalize text-[#f4f1ea]">{headlineEnded ? headlineResult : status.turn}</strong>
                </div>
                <div className="grid min-w-0 gap-0.5 rounded-[7px] border border-[#2d3238] bg-[#191c20] px-2.5 py-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.04em] text-[#727982]">Review</span>
                  <strong className="truncate text-[13px] capitalize text-[#f4f1ea]">
                    {currentMoveReview ? reviewLabel(currentMoveReview.classification) : "Not reviewed"}
                  </strong>
                </div>
                <div className="grid min-w-0 gap-0.5 rounded-[7px] border border-[#2d3238] bg-[#191c20] px-2.5 py-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.04em] text-[#727982]">Score</span>
                  <strong className="truncate text-[13px] capitalize text-[#f4f1ea]">
                    {currentMoveReview ? formatEngineScore(currentMoveReview.evalAfter) : engineScore}
                  </strong>
                </div>
                <div className="grid min-w-0 gap-0.5 rounded-[7px] border border-[#2d3238] bg-[#191c20] px-2.5 py-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.04em] text-[#727982]">Engine</span>
                  <strong className="truncate text-[13px] capitalize text-[#f4f1ea]">{analysisStatus}</strong>
                </div>
              </div>
              {sideTab === "notation" ? (
                <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col rounded-[10px] border border-white/10 bg-[#181a1d]/95 bg-gradient-to-b from-white/[0.05] to-transparent p-[13px] shadow-[0_12px_34px_rgb(0_0_0/0.20)]">
                  {activePuzzle ? (
                    <PuzzleInfoPanel
                      feedback={puzzleFeedback}
                      feedbackKind={puzzleFeedbackKind}
                      lastExpectedMove={puzzleLastExpectedMove}
                      nextError={nextPuzzle.error}
                      nextPending={nextPuzzle.isPending}
                      onNextPuzzle={loadNextPuzzle}
                      onPlayEngineFromHere={playEngineFromCurrentPuzzlePosition}
                      puzzle={activePuzzle}
                      puzzleConfig={activePuzzleConfig}
                      solutionIndex={puzzleSolutionIndex}
                      terminal={status.isEnd}
                    />
                  ) : null}
                  <div className="flex min-h-[34px] items-center justify-between gap-2.5">
                    <h2 className="text-[15px] font-semibold text-[#f4f1ea]">Moves</h2>
                    <button
                      className="inline-flex min-h-[34px] items-center justify-center gap-2 rounded-lg border border-[#30343a] bg-[#222529] px-2.5 py-1.5 text-[13px] text-[#f4f1ea] transition-colors hover:bg-[#2a2e34]"
                      onClick={importPgnFile}
                      title="Open PGN"
                    >
                      <FolderOpen size={16} />
                    </button>
                  </div>
                  <MoveList />
                </div>
              ) : null}
              {sideTab === "review" ? (
                <GameReviewPanel onOpenSettings={() => setAppView("settings")} />
              ) : null}
              {sideTab === "engine" ? <EngineStatusPanel /> : null}
              {sideTab === "library" ? <RecentGames /> : null}
            </div>
          </aside>
        ) : null}
      </section>

      <PromotionDialog />
      {importOpen ? <PgnImportDialog onClose={() => setImportOpen(false)} /> : null}
      {engineControlsOpen ? (
        <EngineGameControls
          onClose={() => setEngineControlsOpen(false)}
          onOpenSettings={() => {
            setEngineControlsOpen(false);
            setAppView("settings");
          }}
        />
      ) : null}
    </main>
  );
}

function HomePage({
  desktopApiAvailable,
  onAnalyze,
  onDatabases,
  onEngineGame,
  onImportPgn,
  onNewGame,
  onPuzzles,
  onReview
}: {
  desktopApiAvailable: boolean;
  onAnalyze: () => void;
  onDatabases: () => void;
  onEngineGame: () => void;
  onImportPgn: () => void;
  onNewGame: () => void;
  onPuzzles: () => void;
  onReview: () => void;
}) {
  const cards = [
    {
      icon: FileSearch,
      title: "Analyze position",
      body: "Keep the engine thinking on the current board and follow the top candidate lines.",
      action: "Start analysis",
      onClick: onAnalyze,
      desktopOnly: true
    },
    {
      icon: BarChart3,
      title: "Game review",
      body: "Run the engine across the whole main line to classify mistakes and turning points.",
      action: "Open review",
      onClick: onReview,
      desktopOnly: true
    },
    {
      icon: Bot,
      title: "Play engine",
      body: "Choose a side, engine, and time control before starting a real match.",
      action: "Configure match",
      onClick: onEngineGame,
      desktopOnly: true
    },
    {
      icon: Puzzle,
      title: "Puzzles",
      body: "Practice tactical positions in a focused board view.",
      action: "Solve puzzles",
      onClick: onPuzzles,
      desktopOnly: true
    },
    {
      icon: Database,
      title: "Databases",
      body: "Download and manage optional puzzle and position datasets.",
      action: "Manage data",
      onClick: onDatabases,
      desktopOnly: true
    }
  ];

  return (
    <div className="mx-auto grid h-full w-full max-w-6xl content-center gap-7 px-8 py-8">
      <div className="grid gap-2">
        <h1 className="text-[28px] font-semibold tracking-[-0.01em] text-[#f4f1ea]">
          Chaturanga
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-[#a9adb4]">
          Start from the workflow you need, then keep the board and right-side tools focused on that job.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {cards.map((card) => {
          const Icon = card.icon;
          const disabled = Boolean(card.desktopOnly && !desktopApiAvailable);
          return (
            <button
              key={card.title}
              type="button"
              className={cn(
                "grid min-h-[220px] content-between gap-5 rounded-[12px] border border-white/10 bg-[#181a1d]/95 bg-gradient-to-b from-white/[0.06] to-transparent p-4 text-left shadow-[0_16px_44px_rgb(0_0_0/0.28)] transition-colors hover:border-[#8fb66f]/45 hover:bg-[#202421]",
                disabled && "cursor-not-allowed opacity-55 hover:border-white/10 hover:bg-[#181a1d]/95"
              )}
              disabled={disabled}
              onClick={card.onClick}
            >
              <span className="grid gap-4">
                <span className="flex size-10 items-center justify-center rounded-[9px] border border-white/10 bg-[#263527] text-[#cce6b2]">
                  <Icon size={20} />
                </span>
                <span className="grid gap-2">
                  <strong className="text-lg text-[#f4f1ea]">{card.title}</strong>
                  <span className="text-[13px] leading-5 text-[#a9adb4]">{card.body}</span>
                </span>
              </span>
              <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-[#d7e8c5]">
                {disabled ? "Desktop app required" : card.action}
                {!disabled ? <ArrowRight size={15} /> : null}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={onNewGame}>
          <RotateCcw size={16} />
          New game
        </Button>
        <Button type="button" variant="outline" onClick={onImportPgn} disabled={!desktopApiAvailable}>
          <Upload size={16} />
          Import PGN
        </Button>
      </div>
    </div>
  );
}

function WebPreviewBanner() {
  return (
    <div className="mx-8 mt-6 rounded-[12px] border border-[#d8ad5a]/25 bg-[#2b2418] px-4 py-3 text-sm text-[#f1d7a6] shadow-[0_12px_34px_rgb(0_0_0/0.20)]">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <div className="grid gap-1">
          <strong className="text-[#ffe7b4]">Web preview mode</strong>
          <span className="leading-5">
            Board navigation and layout preview work in the browser. Engine runs, file dialogs,
            saved games, downloads, and local databases require the desktop app.
          </span>
        </div>
      </div>
    </div>
  );
}

function PuzzleInfoPanel({
  feedback,
  feedbackKind,
  lastExpectedMove,
  nextError,
  nextPending,
  onNextPuzzle,
  onPlayEngineFromHere,
  puzzle,
  puzzleConfig,
  solutionIndex,
  terminal
}: {
  feedback: string | null;
  feedbackKind: "idle" | "correct" | "wrong" | "complete";
  lastExpectedMove: string | null;
  nextError: Error | null;
  nextPending: boolean;
  onNextPuzzle: () => void;
  onPlayEngineFromHere: () => void;
  puzzle: PuzzleSample;
  puzzleConfig: PuzzleSessionConfig | null;
  solutionIndex: number;
  terminal: boolean;
}) {
  const solved = feedbackKind === "complete";
  const wrong = feedbackKind === "wrong";
  const progressCount = solved
    ? puzzle.solutionMoves.length
    : Math.min(solutionIndex, puzzle.solutionMoves.length);
  const progressLabel = `${progressCount} / ${puzzle.solutionMoves.length}`;
  return (
    <div
      className={cn(
        "mb-3 grid gap-3 rounded-lg border p-3",
        wrong
          ? "border-[#d77966]/35 bg-[#3a201d]/50"
          : solved
            ? "border-[#8fb66f]/35 bg-[#263527]/45"
            : "border-[#8fb66f]/25 bg-[#263527]/35"
      )}
    >
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="grid min-w-0 gap-1">
          <strong className="text-[14px] text-[#f4f1ea]">Puzzle #{puzzle.id}</strong>
          <span className="min-w-0 text-[12px] leading-5 text-[#a9adb4]">
            {puzzle.sourceName}
            {puzzle.rating ? ` · ${puzzle.rating}` : ""}
            {puzzle.difficulty ? ` · difficulty ${puzzle.difficulty}` : ""}
          </span>
        </div>
        <span className="inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-white/10 bg-white/[0.055] px-2 text-[11px] font-semibold text-[#d7e8c5]">
          <span
            className={cn(
              "size-2 rounded-full shadow-[0_0_0_1px_rgb(0_0_0/0.35)]",
              puzzle.sideToMove === "white"
                ? "bg-[#efe7d2]"
                : "bg-[#2b3036] shadow-[0_0_0_1px_rgb(255_255_255/0.20)]"
            )}
            aria-hidden="true"
          />
          {puzzle.sideToMove === "white" ? "White" : "Black"}
        </span>
      </div>
      <div
        className={cn(
          "flex items-start gap-2 rounded-md border px-2.5 py-2 text-[12px] leading-5",
          wrong
            ? "border-[#d77966]/30 bg-[#4a2721]/45 text-[#ffcabf]"
            : solved
              ? "border-[#8fb66f]/30 bg-[#273c25]/50 text-[#dff0c8]"
              : "border-white/10 bg-white/[0.04] text-[#d8dbe0]"
        )}
      >
        {wrong ? (
          <XCircle className="mt-0.5 size-4 shrink-0" />
        ) : solved || feedbackKind === "correct" ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
        ) : (
          <Puzzle className="mt-0.5 size-4 shrink-0" />
        )}
        <span className="min-w-0">
          {feedback ?? "Find the best move."}
          {wrong && lastExpectedMove ? (
            <span className="sr-only"> Expected move: {lastExpectedMove}.</span>
          ) : null}
        </span>
        <span className="ml-auto shrink-0 rounded-full border border-white/10 bg-black/20 px-2 py-0.5 font-mono text-[11px] text-[#f4f1ea]">
          {progressLabel}
        </span>
      </div>
      {puzzleConfig ? (
        <div className="grid gap-2 rounded-md border border-white/10 bg-black/10 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#727982]">
              Matching filters
            </span>
            <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[11px] text-[#a9adb4]">
              used by Next
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {puzzleFilterChips(puzzleConfig).map((chip) => (
              <span
                key={chip}
                className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-[#d8dbe0]"
              >
                {chip}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {solved ? (
        <div className="grid gap-2">
          <Button
            type="button"
            variant="secondary"
            className="h-10 justify-center rounded-lg"
            disabled={nextPending}
            onClick={onNextPuzzle}
          >
            <Puzzle size={16} />
            {nextPending ? "Finding next..." : "Next matching puzzle"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-10 justify-center rounded-lg"
            disabled={terminal}
            onClick={onPlayEngineFromHere}
            title={terminal ? "This position is already finished" : "Continue against the default engine"}
          >
            <Swords size={16} />
            Play engine from here
          </Button>
          {nextError ? (
            <span className="text-[12px] leading-5 text-[#ffb5a8]">{nextError.message}</span>
          ) : null}
        </div>
      ) : null}
      <details className="group grid gap-1.5">
        <summary className="cursor-pointer list-none text-[11px] font-semibold uppercase tracking-[0.04em] text-[#727982] transition-colors hover:text-[#d7e8c5]">
          Show solution
        </summary>
        <p className="mt-1 font-mono text-[12px] leading-5 text-[#f4f1ea]">
          {puzzle.solutionMoves.join(" ")}
        </p>
      </details>
      {puzzle.themes.length || puzzle.openingTags.length ? (
        <div className="flex flex-wrap gap-1.5">
          {[...puzzle.themes, ...puzzle.openingTags].slice(0, 10).map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-[#d8dbe0]"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function puzzleInputFromConfig(
  config: PuzzleSessionConfig,
  excludeIds: string[]
): PuzzleSampleInput {
  if (!config.databaseId) throw new Error("Puzzle database not selected.");
  return {
    databaseId: config.databaseId,
    excludeIds,
    lichess: config.lichess,
    position: config.position
  };
}

function puzzleFilterChips(config: PuzzleSessionConfig): string[] {
  if (config.mode === "lichess-puzzle") {
    return [
      `rating ${config.lichess.ratingMin}-${config.lichess.ratingMax}`,
      `popularity ${config.lichess.popularityMin}+`,
      `side ${config.lichess.side}`,
      ...(config.lichess.themes.length ? config.lichess.themes : ["any theme"]),
      ...(config.lichess.openings.length ? config.lichess.openings : []),
      ...(config.lichess.lengths.length ? config.lichess.lengths : [])
    ].slice(0, 12);
  }
  return [
    `difficulty ${config.position.difficultyMin}-${config.position.difficultyMax}`,
    ...(config.position.tags.length ? config.position.tags : ["any tag"])
  ].slice(0, 12);
}

function SidebarCommand({
  active = false,
  description,
  expanded,
  icon: Icon,
  label,
  onClick
}: {
  active?: boolean;
  description?: string;
  expanded: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  const button = (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size={expanded ? "default" : "icon"}
      className={cn(
        "w-full rounded-lg border-transparent bg-transparent text-[#d7d2cb] shadow-none [-webkit-app-region:no-drag] hover:border-transparent hover:bg-white/[0.07] hover:text-[#f4f1ea]",
        expanded
          ? "min-h-[38px] justify-start px-[9px] py-[7px] text-left"
          : "min-h-10",
        active ? "bg-white/10 text-[#fbfff5] hover:bg-white/[0.13]" : null
      )}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active || undefined}
    >
      <Icon size={18} />
      {expanded ? (
        <span className="grid min-w-0 gap-px">
          <strong className="truncate text-[13px] leading-tight">{label}</strong>
          {description ? (
            <em className="truncate text-[11px] not-italic leading-tight text-[#727982]">
              {description}
            </em>
          ) : null}
        </span>
      ) : null}
    </Button>
  );

  if (expanded) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function TitlebarRailToggle({
  className,
  expanded,
  onClick
}: {
  className?: string;
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        "size-8 shrink-0 rounded-md border border-transparent bg-transparent text-[#a9adb4] shadow-none [-webkit-app-region:no-drag] hover:bg-white/[0.08] hover:text-[#f4f1ea]",
        className
      )}
      onClick={onClick}
      aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
      aria-expanded={expanded}
    >
      {expanded ? <PanelLeftClose /> : <PanelLeftOpen />}
    </Button>
  );
}

function CollapsedBrandMenu({
  onAnalyze,
  focusMode,
  onEngineGame,
  onExport,
  onFocusToggle,
  onHome,
  onImport,
  onNewGame,
  onDatabases,
  onPuzzles,
  onReview,
  onSettings
}: {
  onAnalyze: () => void;
  focusMode: boolean;
  onEngineGame: () => void;
  onExport: () => void;
  onFocusToggle: () => void;
  onHome: () => void;
  onImport: () => void;
  onNewGame: () => void;
  onDatabases: () => void;
  onPuzzles: () => void;
  onReview: () => void;
  onSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const actions = [
    { icon: Home, label: "Home", onClick: onHome },
    { icon: RotateCcw, label: "New game", onClick: onNewGame },
    { icon: FileSearch, label: "Analyze", onClick: onAnalyze },
    { icon: BarChart3, label: "Game review", onClick: onReview },
    { icon: Swords, label: "Engine game", onClick: onEngineGame },
    { icon: Puzzle, label: "Puzzles", onClick: onPuzzles },
    { icon: Database, label: "Databases", onClick: onDatabases },
    { icon: Upload, label: "Import PGN", onClick: onImport },
    { icon: Download, label: "Export PGN", onClick: onExport },
    {
      icon: focusMode ? Minimize2 : Maximize2,
      label: focusMode ? "Show panels" : "Focus board",
      onClick: onFocusToggle
    },
    { icon: Settings, label: "Settings", onClick: onSettings }
  ];

  return (
    <div
      className="relative flex shrink-0 items-center [-webkit-app-region:no-drag]"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        className="flex h-9 items-center gap-1 rounded-[9px] border border-white/10 bg-white/[0.03] px-1 py-1 text-[#d7d2cb] outline-none transition-colors hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-[#8fb66f]/50"
        aria-label="Open Chaturanga menu"
        aria-expanded={open}
      >
        <img
          className="h-7 w-7 rounded-[7px] bg-[#101112] bg-gradient-to-br from-[#8fb66f]/30 to-transparent p-1 shadow-inner"
          src={productIcon}
          alt=""
        />
        <ChevronDown size={14} />
      </button>
      <div
        className={cn(
          "fixed left-2 top-[46px] z-[80] w-[280px] rounded-xl border border-white/10 bg-[#242424]/98 p-2 shadow-[0_24px_80px_rgb(0_0_0/0.45)] backdrop-blur transition-[opacity,transform,visibility] duration-150",
          open ? "visible translate-y-0 opacity-100" : "invisible translate-y-1 opacity-0"
        )}
      >
        <div className="flex items-center gap-2 rounded-lg px-2 py-2">
          <img
            className="h-8 w-8 rounded-[8px] border border-white/10 bg-[#101112] bg-gradient-to-br from-[#8fb66f]/30 to-transparent p-1 shadow-inner"
            src={productIcon}
            alt=""
          />
          <div className="grid min-w-0 gap-0.5">
            <strong className="truncate text-[13px] text-[#f4f1ea]">Chaturanga</strong>
            <span className="truncate text-[11px] text-[#a9adb4]">Game commands</span>
          </div>
        </div>
        <Separator className="my-1.5" />
        <div className="grid gap-1">
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                type="button"
                className="flex min-h-9 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium text-[#dedbd6] transition-colors hover:bg-white/[0.07] hover:text-[#f4f1ea]"
                onClick={() => {
                  setOpen(false);
                  action.onClick();
                }}
              >
                <Icon size={16} className="text-[#b9b9b9]" />
                {action.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function latestNodeOnPath(
  moveTree: ReturnType<typeof useGameStore.getState>["moveTree"],
  fromNodeId: string,
  toNodeId: string
) {
  const byId = new Map(moveTree.map((node) => [node.id, node]));
  let cursor = byId.get(toNodeId);
  while (cursor) {
    if (cursor.parentId === fromNodeId) return cursor;
    if (!cursor.parentId) return null;
    cursor = byId.get(cursor.parentId);
  }
  return null;
}

function pickSound(input: {
  san: string;
  result: string;
  isEnd: boolean;
  engineSide: "white" | "black" | null;
  orientation: "white" | "black";
}): SoundKind {
  if (input.isEnd) {
    if (input.result === "1/2-1/2") return "draw";
    const userColor = input.engineSide
      ? input.engineSide === "white"
        ? "black"
        : "white"
      : input.orientation;
    const winner = input.result === "1-0" ? "white" : input.result === "0-1" ? "black" : null;
    if (!winner) return "draw";
    return winner === userColor ? "victory" : "defeat";
  }
  if (input.san.includes("+") || input.san.includes("#")) return "check";
  if (input.san.includes("x")) return "capture";
  return "move";
}
