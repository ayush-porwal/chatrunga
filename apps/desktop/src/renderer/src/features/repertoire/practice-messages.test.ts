import { describe, expect, it } from "vitest";
import { START_FEN } from "@chaturanga/shared/chess/position";
import { firstSightText, moveLabel, wrongMoveText } from "./practice-messages";

const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

describe("practice messages", () => {
  it("names moves with their number", () => {
    expect(moveLabel(START_FEN, "e2e4")).toBe("1.e4");
    expect(moveLabel(AFTER_E4, "c7c6")).toBe("1…c6");
  });

  it("says which move was wrong and which to play, the preferred one first", () => {
    expect(wrongMoveText(AFTER_E4, "e7e5", { ucis: ["c7c5", "c7c6"], preferredUci: "c7c6" })).toBe(
      "Not 1…e5. Your move here is 1…c6. Play it to continue."
    );
    expect(wrongMoveText(AFTER_E4, "e7e5", { ucis: [], preferredUci: null })).toBe(
      "Not 1…e5. Play your move to continue."
    );
  });

  it("shows a new position's move", () => {
    expect(firstSightText(AFTER_E4, "c7c6")).toBe("New position: your move is 1…c6.");
  });
});
