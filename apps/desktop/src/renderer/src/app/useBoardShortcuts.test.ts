import { describe, expect, it } from "vitest";
import { boardShortcutAction } from "./useBoardShortcuts";

type Modifiers = Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "repeat", boolean>>;
const key = (value: string, modifiers: Modifiers = {}) => ({
  key: value,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  ...modifiers
});
const board = { enabled: true, focused: false, overlayOpen: false };

describe("boardShortcutAction", () => {
  it("toggles focus with F and flips with X on a board view", () => {
    expect(boardShortcutAction(key("f"), board)).toBe("toggle-focus");
    expect(boardShortcutAction(key("f"), { ...board, focused: true })).toBe("toggle-focus");
    expect(boardShortcutAction(key("x"), board)).toBe("flip");
  });

  it("leaves focus mode with Escape only while focused", () => {
    expect(boardShortcutAction(key("Escape"), { ...board, focused: true })).toBe("exit-focus");
    expect(boardShortcutAction(key("Escape"), board)).toBeNull();
  });

  it("ignores views without a board, open dialogs/menus, modifiers and key repeat", () => {
    expect(boardShortcutAction(key("f"), { ...board, enabled: false })).toBeNull();
    expect(
      boardShortcutAction(key("Escape"), { ...board, focused: true, overlayOpen: true })
    ).toBeNull();
    expect(boardShortcutAction(key("x"), { ...board, overlayOpen: true })).toBeNull();
    expect(boardShortcutAction(key("f", { metaKey: true }), board)).toBeNull();
    expect(boardShortcutAction(key("F", { shiftKey: true }), board)).toBeNull();
    expect(boardShortcutAction(key("x", { repeat: true }), board)).toBeNull();
  });
});
