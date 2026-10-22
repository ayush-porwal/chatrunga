import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import { enginePicture, fallbackPicture, reviewEngineIdentity } from "./engine-identity";

/** The family whose logo an engine without its own image shows (null: its monogram). */
const family = (engine: Parameters<typeof fallbackPicture>[0]) => {
  const picture = fallbackPicture(engine);
  return picture.kind === "logo" ? picture.family : null;
};
/** The letters on the monogram tile of an engine without a logo. */
const monogram = (name: string) => {
  const picture = fallbackPicture({ name });
  return picture.kind === "monogram" ? picture.text : null;
};
const hue = (name: string) => {
  const picture = fallbackPicture({ name });
  return picture.kind === "monogram" ? picture.hue : null;
};

describe("an engine's family logo", () => {
  it("names the family from managed, user-added, download and UCI names", () => {
    expect(family({ name: "Stockfish (managed)" })).toBe("stockfish");
    expect(family({ name: "Stockfish 17.1" })).toBe("stockfish");
    expect(family({ name: "Maia 1500 (managed)" })).toBe("maia");
    expect(family({ name: "Maia 1100" })).toBe("maia");
    expect(family({ name: "Maia (managed)" })).toBe("maia");
    expect(family({ name: "Lc0" })).toBe("lc0");
    expect(family({ name: "lc0" })).toBe("lc0");
    expect(family({ name: "Lc0 v0.31.2" })).toBe("lc0");
    expect(family({ name: "Leela Chess Zero" })).toBe("lc0");
  });

  it("tells Maia 3 by its runtime, whatever its name", () => {
    expect(family({ name: "Human model", runtime: "maia3" })).toBe("maia");
    expect(family({ name: "Komodo", runtime: "custom-uci" })).toBeNull();
  });

  it("tells Maia from Lc0 by the prediction flag or the weights file", () => {
    expect(family({ name: "Lc0", isHumanPrediction: true })).toBe("maia");
    expect(family({ name: "Lc0", weightsPath: "/nets/maia-1900.pb.gz" })).toBe("maia");
    // Only the file's name counts, not the folders above it.
    expect(family({ name: "Lc0", weightsPath: "/Users/maia/nets/t2.pb.gz" })).toBe("lc0");
  });

  it("is none for an engine without a bundled logo", () => {
    expect(family({ name: "Komodo Dragon 3.3" })).toBeNull();
    expect(family({ name: "Calc0ne" })).toBeNull();
  });
});

describe("an engine's monogram", () => {
  it("takes two words' initials or one word's first two letters", () => {
    expect(monogram("Komodo Dragon")).toBe("KD");
    expect(monogram("Berserk")).toBe("Be");
    expect(monogram("rubichess")).toBe("Ru");
  });

  it("skips version numbers and punctuation", () => {
    expect(monogram("Ethereal 14")).toBe("Et");
    expect(monogram("Koivisto v9.0")).toBe("Ko");
    expect(monogram("Komodo-Dragon 3.3 (x64)")).toBe("KD");
  });

  it("leaves out the managed marker", () => {
    expect(monogram("Berserk (managed)")).toBe("Be");
  });

  it("is empty when no letters are left", () => {
    expect(monogram("")).toBe("");
    expect(monogram("  17.1 ")).toBe("");
  });

  it("is tinted with a hue that is stable per shown name and differs between names", () => {
    const berserk = hue("Berserk");
    expect(berserk).toBeGreaterThanOrEqual(0);
    expect(berserk).toBeLessThan(360);
    expect(hue("Berserk (managed)")).toBe(berserk);
    expect(hue("Komodo Dragon")).not.toBe(berserk);
  });
});

describe("enginePicture", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { chaturanga: { environment: { isElectron: true } } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prefers the engine's own image over its family logo", () => {
    expect(enginePicture({ name: "Stockfish 17.1", imagePath: "/tmp/fish.png" })).toStrictEqual({
      kind: "image",
      src: "chaturanga-image://local/%2Ftmp%2Ffish.png"
    });
    expect(
      enginePicture({ name: "Berserk", imagePath: "data:image/png;base64,abc" })
    ).toStrictEqual({
      kind: "image",
      src: "data:image/png;base64,abc"
    });
  });

  it("falls back to the family logo, then a monogram", () => {
    expect(enginePicture({ name: "Maia 1500 (managed)", imagePath: null })).toMatchObject({
      kind: "logo",
      family: "maia",
      src: expect.any(String)
    });
    expect(enginePicture({ name: "Berserk (managed)", imagePath: "  " })).toStrictEqual({
      kind: "monogram",
      text: "Be",
      hue: hue("Berserk")
    });
  });

  it("ignores remote images, which the app's CSP blocks", () => {
    expect(enginePicture({ name: "Lc0", imagePath: "https://example.com/lc0.png" })).toMatchObject({
      kind: "logo",
      family: "lc0"
    });
    expect(enginePicture({ name: "Berserk", imagePath: "http://example.com/b.png" })).toMatchObject(
      { kind: "monogram", text: "Be" }
    );
  });

  it("falls back without the engine's own image, for one that fails to load", () => {
    expect(fallbackPicture({ name: "Stockfish 17.1", imagePath: "/gone/fish.png" })).toMatchObject({
      kind: "logo",
      family: "stockfish"
    });
    expect(fallbackPicture({ name: "Komodo Dragon", imagePath: "/gone/kd.png" })).toStrictEqual({
      kind: "monogram",
      text: "KD",
      hue: hue("Komodo Dragon")
    });
  });
});

describe("a saved analysis's engine", () => {
  const reckless = { id: "e1", name: "Reckless", imagePath: "/pictures/reckless.png" };
  const engines = [{ id: "sf", name: "Stockfish (managed)" }, reckless] as EngineConfig[];

  it("is the engine row it ran on (with the user's picture), found by id", () => {
    const info = { engineId: "e1", engineName: "Reckless 0.10.0-dev-6ab" };
    expect(reviewEngineIdentity(info, engines)).toBe(engines[1]);
  });

  it("is just its recorded name when that engine is gone, unknown yet, or not recorded", () => {
    const info = { engineId: "removed", engineName: "Reckless 0.10.0-dev-6ab" };
    expect(reviewEngineIdentity(info, engines)).toStrictEqual({ name: info.engineName });
    expect(reviewEngineIdentity({ ...info, engineId: "e1" }, undefined)).toStrictEqual({
      name: info.engineName
    });
    expect(reviewEngineIdentity({ engineId: null, engineName: "Lc0" }, engines)).toStrictEqual({
      name: "Lc0"
    });
    expect(reviewEngineIdentity({ engineId: null, engineName: null }, engines)).toBeNull();
  });
});
