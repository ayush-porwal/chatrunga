import { afterEach, describe, expect, it, vi } from "vitest";
import { rendererCommentaryError, requestRendererCommentary } from "./commentary";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("renderer commentary bridge", () => {
  it("does not expose a secret-read method on the renderer bridge", () => {
    vi.stubGlobal("window", { chaturanga: { commentary: {} } });
    expect("getApiKey" in (window.chaturanga?.commentary ?? {})).toBe(false);
  });

  it("passes generation through the preload bridge", async () => {
    const generate = vi.fn().mockResolvedValue({ commentary: [], error: null });
    vi.stubGlobal("window", { chaturanga: { commentary: { generate } } });

    await expect(requestRendererCommentary({ payloads: [] })).resolves.toEqual({ commentary: [], error: null });
    expect(generate).toHaveBeenCalledWith({ payloads: [] });
  });

  it("turns a renderer/IPC failure into a safe fallback message", () => {
    const message = rendererCommentaryError(new Error("request failed with unit-test-secret"));
    expect(message).toBe("OpenRouter commentary was unavailable; local fallback is shown.");
    expect(message).not.toContain("unit-test-secret");
  });

  it("fails clearly when the desktop commentary bridge is absent", async () => {
    vi.stubGlobal("window", {});
    await expect(requestRendererCommentary({ payloads: [] })).rejects.toThrow("Desktop commentary bridge");
  });
});
