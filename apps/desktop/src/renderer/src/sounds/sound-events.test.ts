import { describe, expect, it } from "vitest";
import { applySan, START_FEN } from "@chaturanga/shared/chess/position";
import {
  lowTimeThresholdMs,
  moveSoundChain,
  resultSound,
  sanOfStep,
  type SoundKind
} from "./sound-events";

describe("moveSoundChain", () => {
  it.each<[string, SoundKind[]]>([
    ["Nf3", ["move"]],
    ["exd5", ["capture", "move"]],
    // A capture that gives check is a check (it used to sound like a quiet move).
    ["Qxe2+", ["check", "capture", "move"]],
    ["Qe5+", ["check", "move"]],
    ["Qxf7#", ["check", "capture", "move"]],
    ["O-O", ["castle", "move"]],
    ["O-O-O+", ["check", "castle", "move"]],
    ["exd8=Q+", ["check", "capture", "move"]]
  ])("%s plays the first of %j the set has", (san, chain) => {
    expect(moveSoundChain(san, false)).toStrictEqual(chain);
  });

  it.each<[string, SoundKind[]]>([
    ["Qe5+", ["move"]],
    ["Qxe2+", ["capture", "move"]],
    ["O-O#", ["castle", "move"]]
  ])("with silent checks, %s sounds like the move that gave it", (san, chain) => {
    expect(moveSoundChain(san, true)).toStrictEqual(chain);
  });
});

describe("resultSound", () => {
  it.each([
    ["1-0", "white", "victory"],
    ["0-1", "white", "defeat"],
    ["0-1", "black", "victory"],
    ["1-0", "black", "defeat"],
    ["1/2-1/2", "white", "draw"],
    ["1/2-1/2", "black", "draw"]
  ] as const)("%s for the user playing %s is a %s", (result, user, sound) => {
    expect(resultSound(result, user)).toBe(sound);
  });

  it("an aborted game (no result) plays nothing", () => {
    expect(resultSound("*", "white")).toBeNull();
  });
});

describe("lowTimeThresholdMs", () => {
  it.each([
    [60_000, 10_000],
    [180_000, 22_500],
    [600_000, 60_000],
    [1_800_000, 60_000]
  ])("a %d ms game warns under %d ms", (initialMs, threshold) => {
    expect(lowTimeThresholdMs(initialMs)).toBe(threshold);
  });
});

function after(fen: string, san: string): string {
  const applied = applySan(fen, san);
  if (!applied) throw new Error(`${san} is not legal`);
  return applied.fen;
}

describe("sanOfStep", () => {
  const e4 = after(START_FEN, "e4");

  it("names the move a step forward played", () => {
    expect(sanOfStep(START_FEN, e4, ["e2", "e4"])).toBe("e4");
  });

  it("a step back, the same position or no last move plays nothing", () => {
    expect([
      sanOfStep(e4, START_FEN, null),
      sanOfStep(after(e4, "e5"), e4, ["e2", "e4"]),
      sanOfStep(e4, e4, ["e2", "e4"]),
      sanOfStep(START_FEN, e4, null)
    ]).toStrictEqual([null, null, null, null]);
  });

  it("a jump of more than one move plays nothing", () => {
    expect(sanOfStep(START_FEN, after(e4, "e5"), ["e7", "e5"])).toBeNull();
  });

  it.each([
    ["e1", "g1"],
    ["e1", "h1"]
  ])("castling, its last move %s-%s, is O-O", (from, to) => {
    const rooks = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    expect(sanOfStep(rooks, after(rooks, "O-O"), [from, to])).toBe("O-O");
  });

  it("finds the piece a pawn promoted to", () => {
    const pawn = "8/P7/8/8/8/8/8/k6K w - - 0 1";
    expect(sanOfStep(pawn, after(pawn, "a8=N"), ["a7", "a8"])).toBe("a8=N");
  });

  it("a board without a position yet plays nothing", () => {
    expect(sanOfStep("", e4, ["e2", "e4"])).toBeNull();
  });
});
