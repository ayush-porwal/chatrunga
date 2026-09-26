import { describe, expect, it } from "vitest";
import { lastNodeOfLine } from "./useMoveKeyboardShortcuts";

describe("lastNodeOfLine", () => {
  const tree = [
    { id: "root", children: ["a"] },
    { id: "a", children: ["b", "x"] },
    { id: "b", children: [] },
    { id: "x", children: ["y"] },
    { id: "y", children: [] }
  ];

  it("follows first children to the end of the line", () => {
    expect(lastNodeOfLine(tree, "root")).toBe("b");
    expect(lastNodeOfLine(tree, "x")).toBe("y");
    expect(lastNodeOfLine(tree, "b")).toBe("b");
  });

  it("stops on a cycle instead of looping forever", () => {
    expect(lastNodeOfLine([{ id: "p", children: ["q"] }, { id: "q", children: ["p"] }], "p")).toBe("p");
  });
});
