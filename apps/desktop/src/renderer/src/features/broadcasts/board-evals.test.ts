import { describe, expect, it } from "vitest";
import { nextEvalBatch } from "./board-evals";

describe("nextEvalBatch", () => {
  it("takes the positions not evaluated yet, once each, four at a time", () => {
    const wanted = ["a", "b", "a", "c", "d", "e", "f"];
    expect(nextEvalBatch(wanted, {})).toStrictEqual(["a", "b", "c", "d"]);
    // A finished position's empty evaluation (null) counts as done.
    expect(nextEvalBatch(wanted, { a: null, b: { type: "cp", value: 20 } })).toStrictEqual([
      "c",
      "d",
      "e",
      "f"
    ]);
  });
});
