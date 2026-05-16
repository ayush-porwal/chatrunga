import { describe, expect, it } from "vitest";
import { classificationClass, stripClass, tagClass } from "./ui";

describe("review classification classes", () => {
  it("returns stable styles for every review classification", () => {
    for (const classification of [
      "best",
      "excellent",
      "good",
      "inaccuracy",
      "mistake",
      "blunder",
      "missed_tactic"
    ] as const) {
      expect(classificationClass(classification)).toContain("border");
      expect(stripClass(classification)).toContain("bg");
      expect(tagClass(classification)).toContain("rounded-full");
    }
  });
});
