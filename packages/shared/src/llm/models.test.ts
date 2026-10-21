import { describe, expect, it } from "vitest";
import { isLightweightCommentaryModel } from "./models";

describe("isLightweightCommentaryModel", () => {
  it("flags lightweight model families", () => {
    expect(isLightweightCommentaryModel("google/gemini-2.5-flash")).toBe(true);
    expect(isLightweightCommentaryModel("openai/gpt-4o-mini")).toBe(true);
    expect(isLightweightCommentaryModel("anthropic/claude-opus-5.5")).toBe(false);
  });
});
