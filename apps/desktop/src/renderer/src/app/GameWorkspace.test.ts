import { describe, expect, it } from "vitest";
import { availableSideTab } from "./GameWorkspace";

describe("availableSideTab", () => {
  it("keeps any tab without a puzzle", () => {
    expect(availableSideTab("library", "none")).toBe("library");
    expect(availableSideTab("engine", "none")).toBe("engine");
  });

  it("never shows Library on a puzzle, nor Engine while the puzzle is being solved", () => {
    expect(availableSideTab("library", "locked")).toBe("notation");
    expect(availableSideTab("library", "open")).toBe("notation");
    expect(availableSideTab("engine", "locked")).toBe("notation");
    expect(availableSideTab("engine", "open")).toBe("engine");
    expect(availableSideTab("notation", "locked")).toBe("notation");
  });
});
