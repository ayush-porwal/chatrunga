import { useState } from "react";
import { Flag, Handshake } from "lucide-react";
import { engineAcceptsHumanDrawOffer } from "@chaturanga/shared/engine/draw-offer";
import { statusForFen } from "@chaturanga/shared/chess/position";
import { useAnalysisStore } from "../../stores/analysis-store";
import { useGameStore } from "../../stores/game-store";
import { invokeEnginesProbeEval } from "../../ipc/engines-probe-eval";
import { currentLineUcis } from "./engine-game-helpers";
import { Button } from "@/components/ui/button";

export function EngineMatchActions() {
  const mode = useGameStore((s) => s.mode);
  const engineSide = useGameStore((s) => s.engineSide);
  const currentFen = useGameStore((s) => s.currentFen);
  const rootFen = useGameStore((s) => s.rootFen);
  const moveTree = useGameStore((s) => s.moveTree);
  const currentNodeId = useGameStore((s) => s.currentNodeId);
  const gameOutcome = useGameStore((s) => s.gameOutcome);
  const analysisStatus = useAnalysisStore((s) => s.status);
  const activeEngineId = useAnalysisStore((s) => s.activeEngineId);
  const [drawBusy, setDrawBusy] = useState(false);

  if (mode !== "engine" || !engineSide || gameOutcome) return null;

  const humanColor = engineSide === "white" ? "black" : "white";
  const status = statusForFen(currentFen);
  const humansTurn = status.turn === humanColor && !status.isEnd;

  async function offerDraw() {
    if (!window.chaturanga || !activeEngineId || !humansTurn || drawBusy) return;
    setDrawBusy(true);
    useGameStore.getState().setMatchFeedback(null);
    try {
      await window.chaturanga.engines.stop();
      useAnalysisStore.getState().setStatus("ready");
      const moves = currentLineUcis(moveTree, currentNodeId);
      const score = await invokeEnginesProbeEval({
        engineId: activeEngineId,
        fen: rootFen,
        moves,
        movetimeMs: 450
      });
      const { accepted, message } = engineAcceptsHumanDrawOffer(score);
      if (accepted) {
        useGameStore.getState().agreeDraw();
        useGameStore.getState().setMatchFeedback(message);
      } else {
        useGameStore.getState().setMatchFeedback(message);
      }
    } catch (error) {
      useGameStore.getState().setMatchFeedback(
        error instanceof Error ? error.message : "Draw offer failed."
      );
    } finally {
      setDrawBusy(false);
    }
  }

  function resign() {
    void window.chaturanga?.engines.stop();
    useAnalysisStore.getState().reset();
    useGameStore.getState().resign();
  }

  return (
    <div className="flex flex-wrap items-center gap-2 [-webkit-app-region:no-drag]">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="[-webkit-app-region:no-drag]"
        disabled={!humansTurn || analysisStatus === "thinking" || drawBusy}
        onClick={() => void offerDraw()}
      >
        <Handshake size={15} />
        Offer draw
      </Button>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        className="[-webkit-app-region:no-drag]"
        disabled={!humansTurn || analysisStatus === "thinking"}
        onClick={resign}
      >
        <Flag size={15} />
        Resign
      </Button>
    </div>
  );
}
