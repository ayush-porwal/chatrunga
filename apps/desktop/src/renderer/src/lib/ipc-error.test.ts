import { describe, expect, it } from "vitest";
import { ipcErrorMessage } from "./ipc-error";

describe("ipcErrorMessage", () => {
  it("strips Electron's invoke wrapper", () => {
    expect(ipcErrorMessage(new Error("Error invoking remote method 'games:save': Error: Disk full"))).toBe("Disk full");
    expect(ipcErrorMessage(new Error("Error invoking remote method 'x': plain"))).toBe("plain");
  });

  it("keeps other messages", () => {
    expect(ipcErrorMessage(new Error("Review cancelled"))).toBe("Review cancelled");
    expect(ipcErrorMessage("text")).toBe("text");
    expect(ipcErrorMessage(null)).toBe("");
  });
});
