import { describe, expect, it } from "vitest";
import { createEmptyGame } from "@chaturanga/shared/chess/pgn";
import type { SavedGame } from "@chaturanga/shared/types/chess";
import type { GameReview } from "@chaturanga/shared/types/engine";
import { reviewWithRealPlies, sessionFromSavedGame } from "./saved-game";

function saved(overrides: Partial<SavedGame> = {}): SavedGame {
  const game = createEmptyGame();
  return {
    id: "g1",
    source: "pgn-import",
    event: "Opera game",
    site: "Paris",
    date: "1858.??.??",
    round: null,
    white: "Morphy",
    black: "Duke",
    result: "1-0",
    currentFen: game.currentFen,
    initialFen: null,
    pgn: "",
    moveTree: game.moveTree,
    review: null,
    ...overrides
  } as SavedGame;
}

describe("sessionFromSavedGame", () => {
  it("maps the row's headers and cursor onto a session", () => {
    const session = sessionFromSavedGame(saved({ currentNodeId: "root" }));
    expect(session).toMatchObject({
      id: "g1",
      source: "pgn-import",
      headers: { event: "Opera game", site: "Paris", white: "Morphy", black: "Duke", result: "1-0" },
      currentNodeId: "root"
    });
    expect(session.rootFen).toBe(session.moveTree[0]?.fenAfter);
  });

  it("finds the cursor from the board position for rows without one", () => {
    expect(sessionFromSavedGame(saved({ currentNodeId: null })).currentNodeId).toBe("root");
  });

  it("uses the stored headers, so Elo, time control and termination survive reopening", () => {
    const session = sessionFromSavedGame(
      saved({ headers: { white: "Morphy", whiteElo: "2690", timeControl: "-", termination: "Normal", result: "*" } })
    );
    expect(session.headers).toMatchObject({ whiteElo: "2690", timeControl: "-", termination: "Normal", result: "1-0" });
  });

  it("recovers the headers of older rows from their PGN", () => {
    const pgn = '[Event "Opera game"]\n[White "Morphy"]\n[WhiteElo "2690"]\n[ECO "C41"]\n[Result "1-0"]\n\n1-0';
    const session = sessionFromSavedGame(saved({ pgn, headers: null }));
    expect(session.headers).toMatchObject({ white: "Morphy", whiteElo: "2690", eco: "C41", site: "Paris", result: "1-0" });
  });
});

describe("reviewWithRealPlies", () => {
  it("renumbers a review saved with an older tree, commentary included", () => {
    const review = { moves: [{ ply: 1 }, { ply: 2 }], commentary: [{ ply: 2 }] } as unknown as GameReview;
    const shifted = reviewWithRealPlies(review, 83);
    expect(shifted?.moves.map((move) => move.ply)).toEqual([84, 85]);
    expect(shifted?.commentary?.map((item) => item.ply)).toEqual([85]);
  });

  it("leaves current reviews alone", () => {
    const review = { moves: [{ ply: 1 }] } as unknown as GameReview;
    expect(reviewWithRealPlies(review, 0)).toBe(review);
    expect(reviewWithRealPlies(null, 5)).toBeNull();
  });
});
