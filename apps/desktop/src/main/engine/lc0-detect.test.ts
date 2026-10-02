import { describe, expect, it } from "vitest";
import { detectLc0, lc0Candidates } from "./lc0-detect";

describe("lc0 detection", () => {
  it("looks in Homebrew and /usr/local before the PATH on macOS", () => {
    expect(lc0Candidates({ platform: "darwin", pathEnv: "/usr/bin:/opt/homebrew/bin", home: "/Users/me" })).toEqual([
      "/opt/homebrew/bin/lc0",
      "/usr/local/bin/lc0",
      "/usr/bin/lc0"
    ]);
  });

  it("covers the usual Linux places and the user's own bin", () => {
    expect(lc0Candidates({ platform: "linux", pathEnv: undefined, home: "/home/me" })).toEqual([
      "/usr/bin/lc0",
      "/usr/local/bin/lc0",
      "/usr/games/lc0",
      "/snap/bin/lc0",
      "/home/me/.local/bin/lc0"
    ]);
  });

  it("picks the first executable candidate, or none", () => {
    const candidates = ["/a/lc0", "/b/lc0", "/c/lc0"];
    expect(detectLc0(candidates, (file) => file !== "/a/lc0")).toBe("/b/lc0");
    expect(detectLc0(candidates, () => false)).toBeNull();
  });
});
