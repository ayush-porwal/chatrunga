import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyGame } from "@chaturanga/shared/chess/pgn";
import type { SavedGame, SavedReviewInfo } from "@chaturanga/shared/types/chess";
import type { GameReview } from "@chaturanga/shared/types/engine";
import { useGameStore } from "../../stores/game-store";
import { useReviewStore } from "../../stores/review-store";
import {
  alignReviewToTree,
  openSavedGame,
  reviewWithRealPlies,
  sessionFromSavedGame,
  showAfterAnalysesDeleted,
  showSavedAnalysis
} from "./saved-game";

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
      headers: {
        event: "Opera game",
        site: "Paris",
        white: "Morphy",
        black: "Duke",
        result: "1-0"
      },
      currentNodeId: "root"
    });
    expect(session.rootFen).toBe(session.moveTree[0]?.fenAfter);
  });

  it("finds the cursor from the board position for rows without one", () => {
    expect(sessionFromSavedGame(saved({ currentNodeId: null })).currentNodeId).toBe("root");
  });

  it("uses the stored headers, so Elo, time control and termination survive reopening", () => {
    const session = sessionFromSavedGame(
      saved({
        headers: {
          white: "Morphy",
          whiteElo: "2690",
          timeControl: "-",
          termination: "Normal",
          result: "*"
        }
      })
    );
    expect(session.headers).toMatchObject({
      whiteElo: "2690",
      timeControl: "-",
      termination: "Normal",
      result: "1-0"
    });
  });

  it("recovers the headers of older rows from their PGN", () => {
    const pgn =
      '[Event "Opera game"]\n[White "Morphy"]\n[WhiteElo "2690"]\n[ECO "C41"]\n[Result "1-0"]\n\n1-0';
    const session = sessionFromSavedGame(saved({ pgn, headers: null }));
    expect(session.headers).toMatchObject({
      white: "Morphy",
      whiteElo: "2690",
      eco: "C41",
      site: "Paris",
      result: "1-0"
    });
  });
});

describe("reviewWithRealPlies", () => {
  it("renumbers a review saved with an older tree, commentary included", () => {
    const review = {
      moves: [{ ply: 1 }, { ply: 2 }],
      commentary: [{ ply: 2 }]
    } as unknown as GameReview;
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

describe("showSavedAnalysis", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useReviewStore.getState().reset();
  });

  const older = {
    reviewId: "older",
    engineId: "sf",
    depth: null,
    moveTimeMs: 100,
    createdAt: 1,
    summary: {},
    moves: []
  } as unknown as GameReview;

  it("shows the analysis asked for", async () => {
    vi.stubGlobal("window", { chaturanga: { games: { getReview: async () => older } } });
    useGameStore.setState({ gameId: "g1" });
    expect(await showSavedAnalysis("g1", "older")).toBe(true);
    expect(useReviewStore.getState().review?.reviewId).toBe("older");
  });

  it("drops a switch that lands after a review started (the run's result must still be saved)", async () => {
    let answer: (review: GameReview) => void = () => undefined;
    vi.stubGlobal("window", {
      chaturanga: {
        games: { getReview: () => new Promise<GameReview>((resolve) => (answer = resolve)) }
      }
    });
    useGameStore.setState({ gameId: "g1" });
    const switching = showSavedAnalysis("g1", "older");
    useReviewStore.getState().startReview("new-run");
    answer(older);
    expect(await switching).toBe(false);
    expect(useReviewStore.getState()).toMatchObject({ status: "running", reviewId: "new-run" });
  });

  it("drops a switch that lands after the game was opened again", async () => {
    let answer: (review: GameReview) => void = () => undefined;
    vi.stubGlobal("window", {
      chaturanga: {
        games: { getReview: () => new Promise<GameReview>((resolve) => (answer = resolve)) }
      }
    });
    useGameStore.setState({ gameId: "g1" });
    const switching = showSavedAnalysis("g1", "older");
    openSavedGame(saved({ id: "g1", reviews: [] }));
    answer(older);
    expect(await switching).toBe(false);
  });
});

describe("showAfterAnalysesDeleted", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useReviewStore.getState().reset();
  });

  const review = (reviewId: string, createdAt: number) =>
    ({
      reviewId,
      engineId: "sf",
      depth: null,
      moveTimeMs: 100,
      createdAt,
      summary: {},
      moves: []
    }) as unknown as GameReview;
  const info = (reviewId: string, createdAt: number) =>
    ({ reviewId, createdAt }) as unknown as SavedReviewInfo;
  const reviews = { a: review("a", 3), b: review("b", 2), c: review("c", 1) };

  /** The game g1 with analyses a (newest), b and c, showing `shown`. */
  function showing(shown: keyof typeof reviews) {
    const getReview = vi.fn(async (_gameId: string, reviewId: string) =>
      reviewId in reviews ? reviews[reviewId as keyof typeof reviews] : null
    );
    vi.stubGlobal("window", { chaturanga: { games: { getReview } } });
    useGameStore.setState({ gameId: "g1" });
    useReviewStore
      .getState()
      .loadReview(reviews[shown], [info("a", 3), info("b", 2), info("c", 1)]);
    return getReview;
  }
  const listed = () => useReviewStore.getState().analyses.map((item) => item.reviewId);

  it("deleting another analysis only drops it from the list", async () => {
    const getReview = showing("a");
    await showAfterAnalysesDeleted("g1", ["b"]);
    expect(listed()).toEqual(["a", "c"]);
    expect(useReviewStore.getState().review?.reviewId).toBe("a");
    expect(getReview).not.toHaveBeenCalled();
  });

  it("deleting the one shown shows the newest left", async () => {
    showing("a");
    await showAfterAnalysesDeleted("g1", ["a"]);
    expect(listed()).toEqual(["b", "c"]);
    expect(useReviewStore.getState()).toMatchObject({
      status: "ready",
      review: { reviewId: "b" }
    });
  });

  it("deleting the last one, or all of them, leaves nothing shown (Analyze again)", async () => {
    showing("c");
    useReviewStore.getState().setAnalyses([info("c", 1)]);
    await showAfterAnalysesDeleted("g1", ["c"]);
    expect(useReviewStore.getState()).toMatchObject({ status: "idle", review: null, analyses: [] });

    showing("b");
    await showAfterAnalysesDeleted("g1", "all");
    expect(useReviewStore.getState()).toMatchObject({ status: "idle", review: null, analyses: [] });
  });

  it("leaves the board alone when another game was opened meanwhile", async () => {
    showing("a");
    useGameStore.setState({ gameId: "g2" });
    await showAfterAnalysesDeleted("g1", "all");
    expect(listed()).toEqual(["a", "b", "c"]);
    expect(useReviewStore.getState().review?.reviewId).toBe("a");
  });
});

describe("alignReviewToTree", () => {
  const tree = [
    { id: "root", parentId: null, children: ["a"], ply: 4 },
    { id: "a", parentId: "root", children: [], ply: 5 }
  ] as unknown as SavedGame["moveTree"];
  const reviewAt = (ply: number) =>
    ({
      engineId: "sf",
      depth: null,
      moveTimeMs: 1,
      createdAt: 1,
      summary: {},
      moves: [{ nodeId: "a", ply }],
      commentary: [{ ply, prose: "", generatedAt: 0, providerModel: "m" }]
    }) as unknown as GameReview;

  it("renumbers an analysis saved before real plies, and leaves one already renumbered alone", () => {
    const legacy = alignReviewToTree(reviewAt(1), tree);
    expect(legacy.moves[0]?.ply).toBe(5);
    expect(legacy.commentary?.[0]?.ply).toBe(5);
    const current = reviewAt(5);
    expect(alignReviewToTree(current, tree)).toBe(current);
  });
});
