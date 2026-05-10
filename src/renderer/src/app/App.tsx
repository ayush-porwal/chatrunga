import { useEffect, useMemo, useState } from "react";
import { Download, FolderOpen, RotateCcw, Settings, Swords, Upload } from "lucide-react";
import { BoardView } from "../features/board/BoardView";
import { MoveList } from "../features/game/MoveList";
import { PgnImportDialog } from "../features/game/PgnImportDialog";
import { EngineSettingsDialog } from "../features/settings/EngineSettingsDialog";
import { EngineGameControls } from "../features/analysis/EngineGameControls";
import { EngineStatusPanel } from "../features/analysis/EngineStatusPanel";
import { PromotionDialog } from "../features/board/PromotionDialog";
import { RecentGames } from "../features/game/RecentGames";
import { useAnalysisStore } from "../stores/analysis-store";
import { useGameStore } from "../stores/game-store";
import { useSaveGameMutation } from "../queries/api";
import { statusForFen } from "../../../shared/chess/position";

export function App() {
  const [importOpen, setImportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [engineControlsOpen, setEngineControlsOpen] = useState(false);
  const game = useGameStore();
  const saveGame = useSaveGameMutation();
  const status = useMemo(() => statusForFen(game.currentFen), [game.currentFen]);

  useEffect(() => {
    const unsubInfo = window.chaturanga.events.onEngineInfo((info) =>
      useAnalysisStore.getState().setInfo(info)
    );
    const unsubBestMove = window.chaturanga.events.onEngineBestMove((bestMove) => {
      useAnalysisStore.getState().setBestMove(bestMove.move);
      const ok = useGameStore.getState().makeUciMove(bestMove.move);
      if (!ok) useAnalysisStore.getState().setError(`Illegal engine move: ${bestMove.move}`);
    });
    const unsubError = window.chaturanga.events.onEngineError((error) =>
      useAnalysisStore.getState().setError(error.message)
    );
    return () => {
      unsubInfo();
      unsubBestMove();
      unsubError();
    };
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const session = useGameStore.getState().toSession();
      if (session.moveTree.length > 1 || session.id) {
        saveGame.mutate({
          id: session.id,
          source: session.source,
          headers: { ...session.headers, result: status.result },
          rootFen: session.rootFen,
          currentFen: session.currentFen,
          pgn: session.pgn,
          moveTree: session.moveTree
        }, {
          onSuccess: (saved) => useGameStore.getState().setGameId(saved.id)
        });
      }
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [game.currentFen, game.moveTree, saveGame, status.result]);

  useEffect(() => {
    if (game.mode !== "engine" || !game.engineSide || status.turn !== game.engineSide || status.isEnd) return;
    const engineId = useAnalysisStore.getState().activeEngineId;
    if (!engineId || useAnalysisStore.getState().status === "thinking") return;
    const moves = currentLineUcis(game.moveTree, game.currentNodeId);
    useAnalysisStore.getState().setStatus("thinking");
    void window.chaturanga.engines.startGame({
      engineId,
      side: game.engineSide,
      fen: game.rootFen,
      moves,
      moveTimeMs: game.moveTimeMs,
      depth: game.depth
    });
  }, [
    game.currentFen,
    game.depth,
    game.engineSide,
    game.mode,
    game.moveTimeMs,
    game.moveTree,
    game.currentNodeId,
    game.rootFen,
    status.isEnd,
    status.turn
  ]);

  async function exportPgn() {
    const session = game.toSession();
    await window.chaturanga.files.savePgnFile("chaturanga-game.pgn", session.pgn);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Chaturanga</h1>
          <p>{status.isEnd ? `Game over ${status.result}` : `${status.turn} to move`}</p>
        </div>
        <div className="toolbar">
          <button onClick={() => game.reset()} title="New game">
            <RotateCcw size={18} />
            New
          </button>
          <button onClick={() => setImportOpen(true)} title="Import PGN">
            <Upload size={18} />
            Import
          </button>
          <button onClick={exportPgn} title="Export PGN">
            <Download size={18} />
            Export
          </button>
          <button onClick={() => setEngineControlsOpen(true)} title="Play engine">
            <Swords size={18} />
            Engine game
          </button>
          <button onClick={() => setSettingsOpen(true)} title="Settings">
            <Settings size={18} />
            Settings
          </button>
        </div>
      </header>

      <section className="workspace">
        <div className="board-column">
          <BoardView />
          <div className="statusbar">
            <span>{game.lastError || useAnalysisStore.getState().error || "Ready"}</span>
            <button onClick={() => game.flip()}>Flip board</button>
          </div>
        </div>

        <aside className="side-panel">
          <div className="panel-section">
            <div className="section-header">
              <h2>Moves</h2>
              <button
                onClick={async () => {
                  const file = await window.chaturanga.files.openPgnFile();
                  if (!file) return;
                  const imported = await window.chaturanga.games.importPgn({ pgn: file.contents });
                  game.loadGame(imported.game);
                }}
              >
                <FolderOpen size={16} />
              </button>
            </div>
            <MoveList />
          </div>
          <EngineStatusPanel />
          <RecentGames />
        </aside>
      </section>

      <PromotionDialog />
      {importOpen ? <PgnImportDialog onClose={() => setImportOpen(false)} /> : null}
      {settingsOpen ? <EngineSettingsDialog onClose={() => setSettingsOpen(false)} /> : null}
      {engineControlsOpen ? (
        <EngineGameControls
          onClose={() => setEngineControlsOpen(false)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      ) : null}
    </main>
  );
}

function currentLineUcis(moveTree: ReturnType<typeof useGameStore.getState>["moveTree"], nodeId: string): string[] {
  const reversed: string[] = [];
  let node = moveTree.find((item) => item.id === nodeId);
  while (node && node.parentId) {
    if (node.uci) reversed.push(node.uci);
    node = moveTree.find((item) => item.id === node?.parentId);
  }
  return reversed.reverse();
}
