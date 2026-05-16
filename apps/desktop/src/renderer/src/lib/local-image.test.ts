import { afterEach, describe, expect, it, vi } from "vitest";
import { localImageSrc } from "./local-image";

describe("localImageSrc", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null for empty paths", () => {
    vi.stubGlobal("window", {});

    expect(localImageSrc(null)).toBeNull();
    expect(localImageSrc("   ")).toBeNull();
  });

  it("passes through URL-like sources", () => {
    vi.stubGlobal("window", {});

    expect(localImageSrc("https://example.com/logo.png")).toBe("https://example.com/logo.png");
    expect(localImageSrc("data:image/png;base64,abc")).toBe("data:image/png;base64,abc");
    expect(localImageSrc("blob:https://example.com/1")).toBe("blob:https://example.com/1");
    expect(localImageSrc("chaturanga-image://local/%2Ftmp%2Flogo.png")).toBe("chaturanga-image://local/%2Ftmp%2Flogo.png");
  });

  it("blocks local filesystem paths in browser mode", () => {
    vi.stubGlobal("window", {});

    expect(localImageSrc("/tmp/logo with space.png")).toBeNull();
  });

  it("converts local filesystem paths in Electron mode", () => {
    vi.stubGlobal("window", {
      chaturanga: {
        environment: { isElectron: true }
      }
    });

    expect(localImageSrc("/tmp/logo with space.png")).toBe("chaturanga-image://local/%2Ftmp%2Flogo%20with%20space.png");
    expect(localImageSrc("file:///tmp/logo%20with%20space.png")).toBe("chaturanga-image://local/%2Ftmp%2Flogo%20with%20space.png");
  });
});
