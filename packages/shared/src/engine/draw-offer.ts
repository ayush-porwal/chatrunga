import type { EngineScore } from "../types/engine";

/**
 * Human offers a draw on their turn; `score` is from the engine's search with side-to-move = human.
 * UCI centipawns are from the mover's perspective (positive = good for the side to move).
 */
export function engineAcceptsHumanDrawOffer(score: EngineScore | null): {
  accepted: boolean;
  message: string;
} {
  if (!score) {
    return { accepted: false, message: "No evaluation — draw declined." };
  }
  if (score.type === "mate") {
    const plies = score.value;
    if (plies > 0) {
      return {
        accepted: false,
        message: "Engine declines — you have a forced mate sequence."
      };
    }
    return {
      accepted: true,
      message: "Engine accepts — forced loss on the board."
    };
  }
  const cp = score.value;
  if (cp < -60) {
    return {
      accepted: false,
      message: "Engine declines — it evaluates a clear advantage."
    };
  }
  if (cp > 60) {
    return {
      accepted: true,
      message: "Engine accepts — it is worse and takes the half point."
    };
  }
  return {
    accepted: true,
    message: "Engine accepts — roughly equal position."
  };
}
