import type { EngineScore, MoveClassification } from "../types/engine";

export function scoreToCentipawns(score: EngineScore): number {
  if (score.type === "cp") return score.value;
  return Math.sign(score.value || 1) * 100000;
}

export function invertScore(score: EngineScore): EngineScore {
  return { type: score.type, value: -score.value };
}

export function scoreFromWhitePerspective(score: EngineScore, turn: "white" | "black"): EngineScore {
  return turn === "white" ? score : invertScore(score);
}

export function formatEngineScore(score: EngineScore | null | undefined): string {
  if (!score) return "-";
  if (score.type === "mate") return `M${score.value}`;
  const value = score.value / 100;
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}

export function classifyMove(input: {
  playedMove: string;
  bestMove: string | null;
  evalLoss: number | null;
  hasMissedTactic: boolean;
}): MoveClassification {
  if (input.bestMove && input.playedMove === input.bestMove) return "best";
  if (input.evalLoss === null) return "good";
  if (input.hasMissedTactic && input.evalLoss >= 150) return "missed_tactic";
  if (input.evalLoss <= 15) return "best";
  if (input.evalLoss <= 35) return "excellent";
  if (input.evalLoss <= 80) return "good";
  if (input.evalLoss <= 150) return "inaccuracy";
  if (input.evalLoss <= 300) return "mistake";
  return "blunder";
}

export function reviewLabel(classification: MoveClassification): string {
  switch (classification) {
    case "best":
      return "Best";
    case "excellent":
      return "Excellent";
    case "good":
      return "Good";
    case "inaccuracy":
      return "Inaccuracy";
    case "mistake":
      return "Mistake";
    case "blunder":
      return "Blunder";
    case "missed_tactic":
      return "Missed tactic";
  }
}
