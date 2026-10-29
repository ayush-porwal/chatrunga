import { describe, expect, it } from "vitest";
import {
  chapterFamilies,
  colorGroups,
  learnedText,
  NO_OPENING_FAMILY,
  openingVariation
} from "./hub-groups";

const chapter = (id: string, sortOrder: number, name: string | null) => ({
  id,
  sortOrder,
  opening: name ? { name, eco: "B12", edited: false } : null
});

describe("hub groups", () => {
  it("groups repertoires by colour, White first, keeping an empty colour", () => {
    const groups = colorGroups([
      { id: "a", color: "black" as const },
      { id: "b", color: "white" as const }
    ]);
    expect(groups.map((group) => [group.color, group.items.map((item) => item.id)])).toStrictEqual([
      ["white", ["b"]],
      ["black", ["a"]]
    ]);
    expect(colorGroups([]).map((group) => group.items)).toStrictEqual([[], []]);
  });

  it("groups chapters by opening family in chapter order, undetected ones together", () => {
    const families = chapterFamilies([
      chapter("c3", 2, "Caro-Kann Defense: Advance Variation"),
      chapter("c1", 0, "Caro-Kann Defense"),
      chapter("c2", 1, null),
      chapter("c4", 3, "London System")
    ]);
    expect(
      families.map((item) => [item.family, item.chapters.map((each) => each.id)])
    ).toStrictEqual([
      ["Caro-Kann Defense", ["c1", "c3"]],
      [NO_OPENING_FAMILY, ["c2"]],
      ["London System", ["c4"]]
    ]);
  });

  it("names a variation and the learned count", () => {
    expect(openingVariation("Caro-Kann Defense: Advance Variation")).toBe("Advance Variation");
    expect(openingVariation("London System")).toBe("");
    expect(learnedText(4, 118)).toBe("4 of 118 learned");
  });
});
