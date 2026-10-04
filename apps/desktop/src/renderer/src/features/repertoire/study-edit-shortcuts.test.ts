import { describe, expect, it } from "vitest";
import { studyEditShortcut, studyEditShortcutLabels } from "./study-edit-shortcuts";

const key = (value: string, modifiers: Partial<KeyboardEvent> = {}) => ({
  key: value,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  ...modifiers
});

describe("studyEditShortcut", () => {
  it("reads ⌘Z / ⇧⌘Z on macOS", () => {
    expect(studyEditShortcut(key("z", { metaKey: true }), true)).toBe("undo");
    expect(studyEditShortcut(key("Z", { metaKey: true, shiftKey: true }), true)).toBe("redo");
    expect(studyEditShortcut(key("z", { ctrlKey: true }), true)).toBeNull();
    expect(studyEditShortcut(key("y", { metaKey: true }), true)).toBeNull();
    expect(studyEditShortcut(key("z", { metaKey: true, altKey: true }), true)).toBeNull();
  });

  it("reads Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y elsewhere", () => {
    expect(studyEditShortcut(key("z", { ctrlKey: true }), false)).toBe("undo");
    expect(studyEditShortcut(key("Z", { ctrlKey: true, shiftKey: true }), false)).toBe("redo");
    expect(studyEditShortcut(key("y", { ctrlKey: true }), false)).toBe("redo");
    expect(studyEditShortcut(key("z", { metaKey: true }), false)).toBeNull();
    expect(studyEditShortcut(key("c", { ctrlKey: true }), false)).toBeNull();
  });

  it("promotes on a plain P, never with a modifier or on repeat", () => {
    for (const mac of [true, false]) {
      expect(studyEditShortcut(key("p"), mac)).toBe("promote");
      expect(studyEditShortcut(key("P", { shiftKey: true }), mac)).toBe("promote");
      expect(studyEditShortcut(key("p", { repeat: true }), mac)).toBeNull();
      expect(studyEditShortcut(key("p", { metaKey: true }), mac)).toBeNull();
      expect(studyEditShortcut(key("p", { ctrlKey: true }), mac)).toBeNull();
      expect(studyEditShortcut(key("z"), mac)).toBeNull();
    }
  });

  it("labels the keys per platform", () => {
    expect(studyEditShortcutLabels(true).undo.label).toBe("⌘Z");
    expect(studyEditShortcutLabels(false).redo.aria).toBe("Control+Y Control+Shift+Z");
  });
});
