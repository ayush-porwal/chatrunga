import { describe, expect, it } from "vitest";
import { createStepScheduler, lastNodeOfLine, nodeAfterSteps } from "./useMoveKeyboardShortcuts";

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
    expect(
      lastNodeOfLine(
        [
          { id: "p", children: ["q"] },
          { id: "q", children: ["p"] }
        ],
        "p"
      )
    ).toBe("p");
  });
});

describe("nodeAfterSteps", () => {
  const tree = [
    { id: "root", parentId: null, children: ["a"] },
    { id: "a", parentId: "root", children: ["b", "x"] },
    { id: "b", parentId: "a", children: ["c"] },
    { id: "c", parentId: "b", children: [] },
    { id: "x", parentId: "a", children: [] }
  ];

  it("walks first children forwards and parents backwards", () => {
    expect(nodeAfterSteps(tree, "root", 2)).toBe("b");
    expect(nodeAfterSteps(tree, "c", -2)).toBe("a");
    expect(nodeAfterSteps(tree, "x", -1)).toBe("a");
  });

  it("stops at either end of the line", () => {
    expect(nodeAfterSteps(tree, "b", 5)).toBe("c");
    expect(nodeAfterSteps(tree, "a", -5)).toBe("root");
    expect(nodeAfterSteps(tree, "a", 0)).toBe("a");
  });
});

describe("createStepScheduler", () => {
  function manualFrames() {
    const queue: Array<() => void> = [];
    return {
      frames: {
        request: (callback: () => void) => queue.push(callback),
        cancel: (handle: number) => {
          queue[handle - 1] = () => {};
        }
      },
      flush: () => queue.splice(0).forEach((callback) => callback())
    };
  }

  it("applies all steps of one frame as a single jump", () => {
    const { frames, flush } = manualFrames();
    const applied: number[] = [];
    const steps = createStepScheduler((delta) => applied.push(delta), frames);
    steps.step(1);
    steps.step(1);
    steps.step(1);
    expect(applied).toEqual([]);
    flush();
    expect(applied).toEqual([3]);
    steps.step(-1);
    flush();
    expect(applied).toEqual([3, -1]);
  });

  it("skips a frame whose steps cancel out, and drops pending steps on cancel", () => {
    const { frames, flush } = manualFrames();
    const applied: number[] = [];
    const steps = createStepScheduler((delta) => applied.push(delta), frames);
    steps.step(1);
    steps.step(-1);
    flush();
    steps.step(1);
    steps.cancel();
    flush();
    expect(applied).toEqual([]);
  });
});
