import { describe, expect, it } from "vitest";
import { detectLc0, lc0Candidates } from "./lc0-detect";

/** A file check that never answers for `hung` (a hung network mount) and finds every other file. */
const hangingOn = (hung: string) => (file: string) =>
  file === hung ? new Promise<boolean>(() => undefined) : Promise.resolve(true);

describe("lc0 detection", () => {
  it("looks in Homebrew and /usr/local before the PATH on macOS", () => {
    expect(
      lc0Candidates({
        platform: "darwin",
        pathEnv: "/usr/bin:/opt/homebrew/bin",
        home: "/Users/me"
      })
    ).toStrictEqual(["/opt/homebrew/bin/lc0", "/usr/local/bin/lc0", "/usr/bin/lc0"]);
  });

  it("covers the usual Linux places and the user's own bin, and skips relative PATH entries", () => {
    expect(
      lc0Candidates({ platform: "linux", pathEnv: "bin:./tools:/opt/lc0", home: "/home/me" })
    ).toStrictEqual([
      "/usr/bin/lc0",
      "/usr/local/bin/lc0",
      "/usr/games/lc0",
      "/snap/bin/lc0",
      "/home/me/.local/bin/lc0",
      "/opt/lc0/lc0"
    ]);
  });

  it("picks the first executable candidate, or none", async () => {
    const candidates = ["/a/lc0", "/b/lc0", "/c/lc0"];
    expect(await detectLc0(candidates, async (file) => file !== "/a/lc0")).toBe("/b/lc0");
    expect(await detectLc0(candidates, async () => false)).toBeNull();
  });

  it("skips a candidate that doesn't answer (a hung network mount)", async () => {
    const found = await detectLc0(["/net/lc0", "/usr/bin/lc0"], hangingOn("/net/lc0"), 20);
    expect(found).toBe("/usr/bin/lc0");
  });
});
