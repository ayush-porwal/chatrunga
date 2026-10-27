import { describe, expect, it } from "vitest";
import { isFullScreenShortcut } from "./full-screen-shortcut";

const f11 = { type: "keyDown", key: "F11", alt: false, control: false, meta: false, shift: false };

describe("isFullScreenShortcut", () => {
  it("is F11 on Windows and Linux", () => {
    expect(isFullScreenShortcut(f11, "win32")).toBe(true);
    expect(isFullScreenShortcut(f11, "linux")).toBe(true);
  });

  it("leaves macOS to the View menu's full-screen shortcuts", () => {
    expect(isFullScreenShortcut(f11, "darwin")).toBe(false);
  });

  it("ignores key-up, other keys and F11 with a modifier", () => {
    expect(isFullScreenShortcut({ ...f11, type: "keyUp" }, "win32")).toBe(false);
    expect(isFullScreenShortcut({ ...f11, key: "F10" }, "win32")).toBe(false);
    expect(isFullScreenShortcut({ ...f11, control: true }, "win32")).toBe(false);
    expect(isFullScreenShortcut({ ...f11, shift: true }, "linux")).toBe(false);
  });
});
