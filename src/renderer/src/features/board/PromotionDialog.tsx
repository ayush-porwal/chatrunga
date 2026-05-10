import { useGameStore } from "../../stores/game-store";

const pieces = [
  ["queen", "Queen"],
  ["rook", "Rook"],
  ["bishop", "Bishop"],
  ["knight", "Knight"]
] as const;

export function PromotionDialog() {
  const pending = useGameStore((state) => state.pendingPromotion);
  const makeMove = useGameStore((state) => state.makeMove);
  const setPendingPromotion = useGameStore((state) => state.setPendingPromotion);
  if (!pending) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal compact">
        <h2>Promote pawn</h2>
        <div className="promotion-grid">
          {pieces.map(([value, label]) => (
            <button
              key={value}
              onClick={() => {
                makeMove({ from: pending.from as never, to: pending.to as never, promotion: value });
                setPendingPromotion(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
