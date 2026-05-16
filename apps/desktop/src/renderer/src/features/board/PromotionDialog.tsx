import { useGameStore } from "../../stores/game-store";
import { usePuzzleStore } from "../../stores/puzzle-store";
import { Button } from "@/components/ui/button";
import { modalBackdrop, modalPanelCompact } from "@/lib/ui";

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
  const solutionIndex = usePuzzleStore((state) => state.solutionIndex);
  if (!pending) return null;

  function choosePromotion(value: (typeof pieces)[number][0]) {
    const played = `${pending?.from}${pending?.to}${promotionSuffix(value)}`;
    const expected = activePuzzle?.solutionMoves[solutionIndex];
    if (mode === "puzzle" && activePuzzle && expected && played !== expected) {
      usePuzzleStore.getState().markWrongMove({ played, expected });
      setPendingPromotion(null);
      return;
    }
    const moved = makeMove({
      from: pending!.from as never,
      to: pending!.to as never,
      promotion: value
    });
    setPendingPromotion(null);
    if (!moved || mode !== "puzzle" || !activePuzzle) return;
    const nextIndex = solutionIndex + 1;
    if (nextIndex >= activePuzzle.solutionMoves.length) {
      usePuzzleStore.getState().markComplete();
    } else {
      usePuzzleStore.getState().advanceSolution(1, "Correct. Continue the line.");
    }
  }

  return (
    <div className={modalBackdrop}>
      <div className={modalPanelCompact}>
        <h2 className="text-[15px] font-semibold text-[#f4f1ea]">Promote pawn</h2>
        <div className="mt-3.5 grid grid-cols-2 gap-2.5">
          {pieces.map(([value, label]) => (
            <Button
              type="button"
              key={value}
              onClick={() => choosePromotion(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

function promotionSuffix(promotion: (typeof pieces)[number][0]): string {
  switch (promotion) {
    case "queen":
      return "q";
    case "rook":
      return "r";
    case "bishop":
      return "b";
    case "knight":
      return "n";
  }
}
