import { describe, expect, it } from "vitest";
import {
  refreshGamesLabel,
  rememberedSource,
  savedGamesHidden,
  syncAccounts,
  syncFailures
} from "./game-review-picker";

describe("Choose a game's filter", () => {
  it("remembers a source when one is chosen", () => {
    expect(
      rememberedSource({ tab: null, reviewed: false }, { tab: "chesscom", reviewed: false })
    ).toBe("chesscom");
  });

  it("forgets the source when All games is chosen", () => {
    expect(
      rememberedSource({ tab: "lichess", reviewed: true }, { tab: null, reviewed: true })
    ).toBeNull();
  });

  it("leaves the source remembered when only Reviewed changes", () => {
    expect(
      rememberedSource({ tab: "lichess", reviewed: false }, { tab: "lichess", reviewed: true })
    ).toBeUndefined();
  });
});

describe("Choose a game's Saved games section", () => {
  const empty = { hasGames: false, needle: "", filter: { tab: null, reviewed: false } };

  it("is left out when the current game is the library's only game", () => {
    expect(savedGamesHidden({ ...empty, hasCurrent: true })).toBe(true);
  });

  it("says the library is empty when there is no current game either", () => {
    expect(savedGamesHidden({ ...empty, hasCurrent: false })).toBe(false);
  });

  it("stays while a search finds nothing", () => {
    expect(savedGamesHidden({ ...empty, needle: "alpha", hasCurrent: true })).toBe(false);
  });

  it("stays while Reviewed is on", () => {
    expect(
      savedGamesHidden({ ...empty, filter: { tab: null, reviewed: true }, hasCurrent: true })
    ).toBe(false);
  });

  it("lists the other saved games", () => {
    expect(savedGamesHidden({ ...empty, hasGames: true, hasCurrent: true })).toBe(false);
  });
});

describe("Choose a game's refresh", () => {
  it("imports from each connected account, Lichess first", () => {
    expect(syncAccounts({ lichess: true, chesscom: true })).toStrictEqual(["lichess", "chesscom"]);
    expect(syncAccounts({ lichess: false, chesscom: true })).toStrictEqual(["chesscom"]);
    expect(syncAccounts({ lichess: false, chesscom: false })).toStrictEqual([]);
  });

  it("is named after the accounts it imports from", () => {
    expect(refreshGamesLabel(["lichess", "chesscom"])).toBe(
      "Refresh games from Lichess and Chess.com"
    );
    expect(refreshGamesLabel(["chesscom"])).toBe("Refresh games from Chess.com");
  });

  it("says why an import failed, with the main process's message or a fallback", () => {
    const failed = new Error("Error invoking remote method 'chesscom:syncGames': Error: Offline");
    expect(syncFailures(["chesscom"], [{ status: "rejected", reason: failed }])).toStrictEqual([
      "Offline"
    ]);
    expect(syncFailures(["lichess"], [{ status: "rejected", reason: null }])).toStrictEqual([
      "Couldn’t import your games."
    ]);
  });

  it("names the failed account when importing from both, and leaves out the ones that worked", () => {
    expect(
      syncFailures(
        ["lichess", "chesscom"],
        [
          { status: "fulfilled", value: { imported: 2, skipped: 0 } },
          { status: "rejected", reason: new Error("Offline") }
        ]
      )
    ).toStrictEqual(["Chess.com: Offline"]);
  });
});
