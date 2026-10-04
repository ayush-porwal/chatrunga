import type { UserMove } from "@chaturanga/shared/types/chess";
import { useGameStore } from "../../stores/game-store";
import { usePuzzleStore } from "../../stores/puzzle-store";
import { submitPuzzleMove } from "../puzzles/puzzle-session";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { uciFromUserMove, userMoveBetween } from "@/lib/uci";

const pieces = [
  ["queen", "Queen"],
  ["rook", "Rook"],
  ["bishop", "Bishop"],
  ["knight", "Knight"]
] as const;

export function PromotionDialog() {
  const pending = useGameStore((state) => state.pendingPromotion);
  const makeMove = useGameStore((state) => state.makeMove);
  const mode = useGameStore((state) => state.mode);
  const setPendingPromotion = useGameStore((state) => state.setPendingPromotion);
  const activePuzzle = usePuzzleStore((state) => state.activePuzzle);
  if (!pending) return null;

  function choosePromotion(promotion: NonNullable<UserMove["promotion"]>) {
    if (!pending) return;
    const move = userMoveBetween(pending.from, pending.to, promotion);
    setPendingPromotion(null);
    if (!move) return;
    if (mode === "puzzle" && activePuzzle)
      submitPuzzleMove(uciFromUserMove(move), () => makeMove(move));
    else makeMove(move);
  }

  return (
    <Dialog title="Promote pawn" size="sm">
      <div className="grid grid-cols-2 gap-2">
        {pieces.map(([value, label]) => (
          <Button
            type="button"
            key={value}
            variant={value === "queen" ? "primary" : "outline"}
            autoFocus={value === "queen"}
            onClick={() => choosePromotion(value)}
          >
            {label}
          </Button>
        ))}
      </div>
    </Dialog>
  );
}
