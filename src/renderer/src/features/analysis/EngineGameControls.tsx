import { useMemo, useState } from "react";
import { useEnginesQuery } from "../../queries/api";
import { useAnalysisStore } from "../../stores/analysis-store";
import { useGameStore } from "../../stores/game-store";
import { statusForFen } from "../../../../shared/chess/position";

export function EngineGameControls({
  onClose,
  onOpenSettings
}: {
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const engines = useEnginesQuery();
  const game = useGameStore();
  const defaultEngine = useMemo(
    () => engines.data?.find((engine) => engine.isDefault) ?? engines.data?.[0],
    [engines.data]
  );
  const [engineId, setEngineId] = useState(defaultEngine?.id ?? "");
  const [side, setSide] = useState<"white" | "black">("white");
  const [moveTimeMs, setMoveTimeMs] = useState(game.moveTimeMs);
  const [depth, setDepth] = useState<number | null>(game.depth);

  async function startGame() {
    const selectedEngineId = engineId || defaultEngine?.id;
    if (!selectedEngineId) {
      onOpenSettings();
      return;
    }
    game.reset();
    game.setMode("engine");
    game.setEngineSide(side === "white" ? "black" : "white");
    game.setEngineLimits(moveTimeMs, depth);
    useAnalysisStore.getState().setActiveEngine(selectedEngineId);
    useAnalysisStore.getState().setStatus("starting");
    onClose();

    if (side === "black") {
      await window.chaturanga.engines.startGame({
        engineId: selectedEngineId,
        side: "white",
        fen: game.rootFen,
        moves: [],
        moveTimeMs,
        depth
      });
    }
  }

  async function stop() {
    await window.chaturanga.engines.stop();
    useAnalysisStore.getState().reset();
    game.setMode("freeplay");
    game.setEngineSide(null);
  }

  const currentStatus = statusForFen(game.currentFen);

  return (
    <div className="modal-backdrop">
      <div className="modal compact">
        <div className="modal-header">
          <h2>Engine game</h2>
          <button onClick={onClose}>Close</button>
        </div>
        {engines.data?.length ? (
          <>
            <label>
              Engine
              <select value={engineId || defaultEngine?.id} onChange={(event) => setEngineId(event.target.value)}>
                {engines.data.map((engine) => (
                  <option key={engine.id} value={engine.id}>{engine.name}</option>
                ))}
              </select>
            </label>
            <label>
              Play as
              <select value={side} onChange={(event) => setSide(event.target.value as "white" | "black")}>
                <option value="white">White</option>
                <option value="black">Black</option>
              </select>
            </label>
            <label>
              Move time
              <input
                type="number"
                min={100}
                value={moveTimeMs}
                onChange={(event) => setMoveTimeMs(Number(event.target.value))}
              />
            </label>
            <label>
              Depth
              <input
                type="number"
                min={1}
                value={depth ?? ""}
                placeholder="Optional"
                onChange={(event) => setDepth(event.target.value ? Number(event.target.value) : null)}
              />
            </label>
            <p className="muted">{currentStatus.turn} to move in the current position.</p>
            <div className="dialog-actions">
              <button onClick={stop}>Stop</button>
              <button className="primary" onClick={startGame}>Start</button>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <p>No UCI engine is configured.</p>
            <button className="primary" onClick={onOpenSettings}>Open settings</button>
          </div>
        )}
      </div>
    </div>
  );
}
