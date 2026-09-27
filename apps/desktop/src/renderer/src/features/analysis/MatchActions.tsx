import { useEffect, useState } from "react";
import { BarChart3, Flag, Handshake, Loader2, Swords, X } from "lucide-react";
import { engineAcceptsHumanDrawOffer } from "@chaturanga/shared/engine/draw-offer";
import { statusForFen } from "@chaturanga/shared/chess/position";
import { useAnalysisStore } from "../../stores/analysis-store";
import { useGameStore } from "../../stores/game-store";
import { currentLineUcis } from "./engine-game-helpers";
import { lichessErrorMessage } from "../lichess/lichess-game";
import { useLichessStore, type LiveLichessGame } from "../../stores/lichess-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * The titlebar's match controls: Offer draw / Resign against the engine; online, the Lichess game's
 * controls (abort, draw offers, resign) and, once it ends, Review and Play again.
 */
export function MatchActions({ onReview, onPlayAgain }: { onReview: () => void; onPlayAgain: () => void }) {
  const mode = useGameStore((s) => s.mode);
  const live = useLichessStore((s) => s.live);
  if (mode === "online" && live) return <LichessMatchActions live={live} onReview={onReview} onPlayAgain={onPlayAgain} />;
  return <EngineMatchActions />;
}

function EngineMatchActions() {
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
      const score = await window.chaturanga.engines.probeEval({
        engineId: activeEngineId,
        fen: rootFen,
        moves,
        movetimeMs: 450
      });
      const { accepted, message } = engineAcceptsHumanDrawOffer(score);
      if (accepted) useGameStore.getState().agreeDraw();
      useGameStore.getState().setMatchFeedback(message);
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
        variant="ghost"
        size="sm"
        disabled={!humansTurn || analysisStatus === "thinking" || drawBusy}
        onClick={() => void offerDraw()}
      >
        <Handshake />
        Offer draw
      </Button>
      <Button
        type="button"
        variant="ghost-destructive"
        size="sm"
        disabled={!humansTurn || analysisStatus === "thinking"}
        onClick={resign}
      >
        <Flag />
        Resign
      </Button>
    </div>
  );
}

function LichessMatchActions({ live, onReview, onPlayAgain }: { live: LiveLichessGame; onReview: () => void; onPlayAgain: () => void }) {
  const plies = useGameStore((s) => Math.max(0, s.moveTree.length - 1));
  const [busy, setBusy] = useState(false);
  const [confirmResign, setConfirmResign] = useState(false);
  // The confirm step lapses on its own, like Lichess's.
  useEffect(() => {
    if (!confirmResign) return;
    const timer = window.setTimeout(() => setConfirmResign(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmResign]);

  if (live.over) {
    return (
      <div className="flex flex-wrap items-center gap-2 [-webkit-app-region:no-drag]">
        <Button type="button" variant="ghost" size="sm" onClick={onPlayAgain}>
          <Swords />
          Play again
        </Button>
        <Button type="button" variant="primary" size="sm" onClick={onReview}>
          <BarChart3 />
          Review game
        </Button>
      </div>
    );
  }

  const api = window.chaturanga?.lichess;
  const opponent = live.yourColor === "white" ? "black" : "white";
  const opponentOffers = live.drawOffer === opponent;
  const youOffered = live.drawOffer === live.yourColor;
  // Lichess lets either side abort until both have moved.
  const canAbort = plies < 2;

  function run(action: (() => Promise<void>) | undefined, fallback: string) {
    if (!action || busy) return;
    setBusy(true);
    action()
      .catch((error: unknown) => useGameStore.getState().setMatchFeedback(lichessErrorMessage(error, fallback)))
      .finally(() => setBusy(false));
  }

  return (
    <div className="flex flex-wrap items-center gap-2 [-webkit-app-region:no-drag]">
      {live.connected ? null : (
        <Badge tone="warn" size="md" appear>
          <Loader2 className="animate-spin" />
          Reconnecting…
        </Badge>
      )}
      {canAbort ? (
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => run(api && (() => api.abort(live.id)), "Couldn’t abort the game.")}>
          <X />
          Abort
        </Button>
      ) : opponentOffers ? (
        <>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => run(api && (() => api.declineDraw(live.id)), "Couldn’t decline the draw.")}>
            Decline draw
          </Button>
          <Button type="button" variant="primary" size="sm" disabled={busy} onClick={() => run(api && (() => api.offerDraw(live.id)), "Couldn’t accept the draw.")}>
            <Handshake />
            Accept draw
          </Button>
        </>
      ) : (
        <Button type="button" variant="ghost" size="sm" disabled={busy || youOffered} onClick={() => run(api && (() => api.offerDraw(live.id)), "Couldn’t offer a draw.")}>
          <Handshake />
          {youOffered ? "Draw offered" : "Offer draw"}
        </Button>
      )}
      {canAbort ? null : (
        <Button
          type="button"
          variant="ghost-destructive"
          size="sm"
          disabled={busy}
          onClick={() => {
            if (!confirmResign) setConfirmResign(true);
            else {
              setConfirmResign(false);
              run(api && (() => api.resign(live.id)), "Couldn’t resign.");
            }
          }}
        >
          <Flag />
          {confirmResign ? "Confirm resign" : "Resign"}
        </Button>
      )}
    </div>
  );
}
