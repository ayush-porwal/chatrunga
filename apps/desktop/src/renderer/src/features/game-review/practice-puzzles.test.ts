import { describe, expect, it } from "vitest";
import { findOpeningPuzzles } from "./practice-puzzles";

const NAJDORF = "Sicilian Defense: Najdorf Variation, English Attack";

describe("findOpeningPuzzles", () => {
  it("is the exact variation when the database has its puzzles", async () => {
    const asked: string[] = [];
    const search = await findOpeningPuzzles(NAJDORF, async (tag) => {
      asked.push(tag);
      return true;
    });
    expect(search).toEqual({ status: "found", tag: "Sicilian_Defense_Najdorf_Variation" });
    expect(asked).toEqual(["Sicilian_Defense_Najdorf_Variation"]);
  });

  it("falls back to the family when the variation has no puzzles", async () => {
    const search = await findOpeningPuzzles(NAJDORF, async (tag) => tag === "Sicilian_Defense");
    expect(search).toEqual({ status: "found", tag: "Sicilian_Defense" });
  });

  it("says there are none when even the family has none", async () => {
    expect(await findOpeningPuzzles(NAJDORF, async () => false)).toEqual({ status: "none" });
    expect(await findOpeningPuzzles("Bird Opening", async () => false)).toEqual({
      status: "none"
    });
  });

  it("uses a tag it couldn't check as is (the Puzzles page says what's wrong)", async () => {
    expect(await findOpeningPuzzles(NAJDORF, async () => null)).toEqual({
      status: "found",
      tag: "Sicilian_Defense_Najdorf_Variation"
    });
  });

  it("gives up when the user leaves, between or during searches", async () => {
    const leave = new AbortController();
    const asked: string[] = [];
    const search = await findOpeningPuzzles(
      NAJDORF,
      async (tag) => {
        asked.push(tag);
        leave.abort();
        return false;
      },
      leave.signal
    );
    expect(search).toEqual({ status: "cancelled" });
    // The family is never searched for once the user has gone.
    expect(asked).toEqual(["Sicilian_Defense_Najdorf_Variation"]);
    expect(await findOpeningPuzzles(NAJDORF, async () => true, leave.signal)).toEqual({
      status: "cancelled"
    });
  });
});
