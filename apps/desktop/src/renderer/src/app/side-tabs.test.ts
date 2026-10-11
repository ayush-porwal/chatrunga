import { describe, expect, it } from "vitest";
import { availableSideTab, showsEngine, sideTabFrom } from "./side-tabs";

describe("availableSideTab", () => {
  it("keeps any tab without a puzzle", () => {
    expect(availableSideTab("library", "none")).toBe("library");
    expect(availableSideTab("notation", "none")).toBe("notation");
  });

  it("never shows Library on a puzzle", () => {
    expect(availableSideTab("library", "locked")).toBe("notation");
    expect(availableSideTab("library", "open")).toBe("notation");
    expect(availableSideTab("notation", "locked")).toBe("notation");
  });
});

describe("sideTabFrom", () => {
  it("reads the old Engine tab (merged into Moves) and unknown values as Moves", () => {
    expect(sideTabFrom("engine")).toBe("notation");
    expect(sideTabFrom(undefined)).toBe("notation");
    expect(sideTabFrom("notation")).toBe("notation");
    expect(sideTabFrom("library")).toBe("library");
  });
});

describe("showsEngine", () => {
  it("hides the engine only while a puzzle is being solved", () => {
    expect(showsEngine("none")).toBe(true);
    expect(showsEngine("open")).toBe(true);
    expect(showsEngine("locked")).toBe(false);
  });
});
