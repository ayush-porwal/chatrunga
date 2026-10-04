import { describe, expect, it } from "vitest";
import { historyShortcut } from "./useHistoryShortcuts";

const key = (
  key: string,
  mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}
) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods
});

describe("historyShortcut", () => {
  it("uses ⌘[ and ⌘] on macOS", () => {
    expect(historyShortcut(key("[", { metaKey: true }), true)).toBe("back");
    expect(historyShortcut(key("]", { metaKey: true }), true)).toBe("forward");
    expect(historyShortcut(key("ArrowLeft", { altKey: true }), true)).toBeNull();
  });

  it("uses Alt+← and Alt+→ elsewhere", () => {
    expect(historyShortcut(key("ArrowLeft", { altKey: true }), false)).toBe("back");
    expect(historyShortcut(key("ArrowRight", { altKey: true }), false)).toBe("forward");
  });

  it("leaves plain arrows to the move list", () => {
    expect(historyShortcut(key("ArrowLeft"), true)).toBeNull();
    expect(historyShortcut(key("ArrowLeft"), false)).toBeNull();
    expect(historyShortcut(key("[", { metaKey: true, shiftKey: true }), true)).toBeNull();
  });
});
