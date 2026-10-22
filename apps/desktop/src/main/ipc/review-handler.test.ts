import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, type AppSettings } from "@chaturanga/shared/types/settings";
import type {
  EngineConfig,
  GameReview,
  MoveReview,
  RatingPrediction,
  ReviewGameInput
} from "@chaturanga/shared/types/engine";
import {
  MAIA3_RATINGS,
  type Maia3Evaluator,
  type Maia3Output,
  type Maia3Query
} from "@chaturanga/shared/engine/maia3";
import { fixtureMaia3Output } from "../maia/fixture-evaluator";
import type { reviewGameWithEngine as runReview } from "../engine/review";
import {
  telemetryDatabase,
  AVAILABLE,
  fakeEndpoint
} from "../telemetry/__fixtures__/telemetry-fixtures";

type Recorded = { event: string; [property: string]: unknown };

const engine: EngineConfig = {
  id: "sf",
  name: "Stockfish 17",
  executablePath: "/engines/stockfish",
  workingDirectory: null,
  weightsPath: null,
  imagePath: null,
  args: [],
  protocol: "uci",
  runtime: "custom-uci",
  isAvailable: true,
  isDefault: true,
  createdAt: 0,
  updatedAt: 0
};

let settings: AppSettings = { ...defaultSettings, reviewUseMaia: false };
const getReview = vi.fn<(gameId: string, reviewId: string) => GameReview | null>();
const saveMaiaCurve = vi.fn((..._args: unknown[]) => true);
vi.mock("../db/repositories", () => ({
  settingsRepository: { getAll: () => settings },
  gameRepository: {
    getReview: (gameId: string, reviewId: string) => getReview(gameId, reviewId),
    saveMaiaCurve: (...args: unknown[]) => saveMaiaCurve(...args)
  }
}));
vi.mock("../engine/engine-config", () => ({
  engineConfigForId: (id: string) => (id === "sf" ? engine : null),
  engineResourceOptions: () => ({ threads: 1, hashMb: 16 })
}));
vi.mock("../engine/asset-manager", () => ({
  getAssetManager: () => ({
    getInstalled: () => ({ maia3: { version: "maia3_simplified@0013cc8", manifestVersion: null } })
  })
}));
const reviewGameWithEngine = vi.fn<typeof runReview>();
vi.mock("../engine/review", () => ({
  reviewGameWithEngine: (...args: Parameters<typeof runReview>) => reviewGameWithEngine(...args)
}));

/** Maia 3 as main gets it: installed or not; its answers wait for `gate` when one is set. */
const maia = {
  installed: true,
  gate: null as Promise<void> | null,
  calls: [] as { queries: Maia3Query[]; priority?: string }[]
};
const evaluator: Maia3Evaluator = {
  isInstalled: () => maia.installed,
  dispose: () => {},
  evaluate: async (queries, { priority } = {}): Promise<Maia3Output[]> => {
    maia.calls.push({ queries: [...queries], priority });
    await maia.gate;
    return queries.map(fixtureMaia3Output);
  }
};
vi.mock("../maia", () => ({ getMaia3Evaluator: () => evaluator }));

const { reviewRatingFor, runGameReview } = await import("./review-handler");
const { maiaCurve, parseMaiaCurveInput } = await import("./maia-curve");
const { initTelemetry } = await import("../telemetry");

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const finished = {
  engineId: "sf",
  depth: null,
  moveTimeMs: 100,
  createdAt: 1,
  summary: {},
  moves: []
} as unknown as GameReview;

function fakeManager() {
  const cancelled = new Set<string>();
  return {
    cancelled,
    emit: vi.fn(),
    clearReviewCancellation: (id: string) => cancelled.delete(id),
    trackReview: vi.fn(),
    isReviewCancelled: (id: string) => cancelled.has(id)
  };
}

function input(reviewId: string, gameId: string | null = "game-1"): ReviewGameInput {
  return { reviewId, gameId, engineId: "sf", rootFen: START, moves: [], moveTimeMs: 100 };
}

let db: ReturnType<typeof telemetryDatabase>;
const events = () =>
  (
    db.prepare("SELECT event, payload_json FROM telemetry_outbox ORDER BY rowid").all() as {
      event: string;
      payload_json: string;
    }[]
  ).map(
    (row): Recorded => ({
      event: row.event,
      ...(JSON.parse(row.payload_json) as Record<string, unknown>)
    })
  );

describe("review handler", () => {
  beforeEach(() => {
    db = telemetryDatabase();
    initTelemetry({
      config: AVAILABLE,
      database: () => db,
      consent: () => true,
      fetchImpl: fakeEndpoint().fetchImpl,
      appVersion: "1.0.0",
      platform: "linux",
      arch: "x64"
    });
    reviewGameWithEngine.mockReset();
    settings = { ...defaultSettings, reviewUseMaia: false };
    maia.installed = true;
    maia.gate = null;
    maia.calls = [];
    getReview.mockReset();
    saveMaiaCurve.mockClear();
  });

  describe("runGameReview analytics", () => {
    it("reviewing one game three times is three operations on one game", async () => {
      reviewGameWithEngine.mockResolvedValue(finished);
      const manager = fakeManager();
      const results = [];
      for (const id of ["r1", "r2", "r3"])
        results.push(await runGameReview(manager as never, input(id)));
      // The operation id is kept with the review, so opening it later is attributable.
      expect(results.map((review) => review.reviewId)).toStrictEqual(["r1", "r2", "r3"]);

      const completed = events().filter((event) => event.event === "review_completed");
      expect(completed.map((event) => event.review_id)).toStrictEqual(["r1", "r2", "r3"]);
      expect(new Set(completed.map((event) => event.game_ref)).size).toBe(1);
      expect(completed[0]).toMatchObject({
        engine_family: "stockfish",
        ply_count: 0,
        maia_used: false
      });
      expect(events().filter((event) => event.event === "review_started")).toHaveLength(3);
      expect(events().filter((event) => event.event === "activation_milestone")).toHaveLength(1);
    });

    it("a cancelled review is a cancellation, not a failure; an error is a coded failure", async () => {
      const manager = fakeManager();
      reviewGameWithEngine.mockImplementationOnce(async () => {
        manager.cancelled.add("r-cancel");
        throw new Error("Review cancelled");
      });
      await expect(runGameReview(manager as never, input("r-cancel"))).rejects.toThrow(
        "Review cancelled"
      );
      reviewGameWithEngine.mockRejectedValueOnce(
        new Error("sf exited unexpectedly (code 9) at /Users/me/engines/sf")
      );
      await expect(runGameReview(manager as never, input("r-fail"))).rejects.toThrow(
        /sf exited unexpectedly/
      );

      const terminal = events().filter((event) =>
        ["review_completed", "review_failed", "review_cancelled"].includes(String(event.event))
      );
      expect(terminal.map((event) => [event.event, event.review_id])).toStrictEqual([
        ["review_cancelled", "r-cancel"],
        ["review_failed", "r-fail"]
      ]);
      expect(terminal[1]).toMatchObject({ error_code: "engine_exited" });
      // The error text (with its path) is never recorded.
      expect(JSON.stringify(events())).not.toContain("/Users/me");
    });

    it("a review still completes when analytics storage fails", async () => {
      initTelemetry({
        config: AVAILABLE,
        database: () => {
          throw new Error("disk full");
        },
        consent: () => true,
        fetchImpl: fakeEndpoint().fetchImpl,
        appVersion: "1.0.0",
        platform: "linux",
        arch: "x64"
      });
      reviewGameWithEngine.mockResolvedValue(finished);
      await expect(
        runGameReview(fakeManager() as never, input("r-ok", null))
      ).resolves.toMatchObject({ reviewId: "r-ok" });
    });
  });

  describe("the rating a review is made for", () => {
    it("is the game's own rating for the reviewed side, saved with the review", async () => {
      reviewGameWithEngine.mockResolvedValue(finished);
      const review = await runGameReview(fakeManager() as never, {
        ...input("r-rated"),
        timeControl: "180+2",
        rating: { side: "black", whiteElo: 2010, blackElo: 1533, speed: null }
      });
      // This profile runs no Maia (reviewUseMaia off), so no model is named.
      expect(reviewGameWithEngine.mock.lastCall?.[3]).toMatchObject({ maia: null });
      expect(review.rating).toStrictEqual({
        rating: 1533,
        source: "game",
        mode: "blitz",
        maiaModel: null
      });
      // The side it was made for is saved with it (Review as).
      expect(review.side).toBe("black");
    });

    it("is the Settings rating for the game's mode without one, rapid without a time control", async () => {
      reviewGameWithEngine.mockResolvedValue(finished);
      const review = await runGameReview(fakeManager() as never, { ...input("r-unrated") });
      expect(review.rating).toMatchObject({ rating: 1500, source: "settings", mode: "rapid" });
      // Without a side from the renderer, the Settings side.
      expect(review.side).toBe("white");
    });
  });

  describe("Maia 3 in a review", () => {
    const rated = {
      ...input("r-maia"),
      useMaia: true,
      timeControl: "180+2",
      rating: { side: "black" as const, whiteElo: 2010, blackElo: 1533, speed: null }
    };

    it("reads each side at its own game rating, snapped to Maia's grid, and names the reviewed side's", async () => {
      reviewGameWithEngine.mockResolvedValue({
        ...finished,
        maia: {
          model: "maia3",
          modelVersion: "v",
          white: { rating: 2000, source: "game" },
          black: { rating: 1500, source: "game" }
        }
      });
      const review = await runGameReview(fakeManager() as never, rated);
      expect(reviewGameWithEngine.mock.lastCall?.[3]?.maia).toStrictEqual({
        evaluator,
        modelVersion: "maia3_simplified@0013cc8",
        ratings: {
          white: { rating: 2000, source: "game" },
          black: { rating: 1500, source: "game" }
        }
      });
      expect(review.rating).toStrictEqual({
        rating: 1533,
        source: "game",
        mode: "blitz",
        maiaModel: 1500
      });
      expect(events().find((event) => event.event === "review_started")).toMatchObject({
        maia_used: true,
        maia_model: "maia3"
      });
    });

    it("reads both sides at the Review-settings rating when one is set", async () => {
      settings = { ...settings, reviewMaiaRating: 1150 };
      reviewGameWithEngine.mockResolvedValue(finished);
      await runGameReview(fakeManager() as never, rated);
      expect(reviewGameWithEngine.mock.lastCall?.[3]?.maia?.ratings).toStrictEqual({
        white: { rating: 1200, source: "override" },
        black: { rating: 1200, source: "override" }
      });
    });

    it("runs when the setting is on and the review doesn't say; never when Maia 3 isn't installed", async () => {
      reviewGameWithEngine.mockResolvedValue(finished);
      settings = { ...settings, reviewUseMaia: true };
      await runGameReview(fakeManager() as never, input("r-setting"));
      expect(reviewGameWithEngine.mock.lastCall?.[3]?.maia).toMatchObject({ evaluator });
      await runGameReview(fakeManager() as never, { ...input("r-off"), useMaia: false });
      expect(reviewGameWithEngine.mock.lastCall?.[3]?.maia).toBeNull();
      maia.installed = false;
      await runGameReview(fakeManager() as never, rated);
      expect(reviewGameWithEngine.mock.lastCall?.[3]?.maia).toBeNull();
    });
  });

  describe("reviewRatingFor", () => {
    it("names the rating Maia read the reviewed side at as its model", () => {
      const ratings = {
        reviewPlayerColor: "white" as const,
        playerRatings: {
          ...defaultSettings.playerRatings,
          blitz: { source: "manual" as const, rating: 1000 }
        }
      };
      expect(reviewRatingFor({ timeControl: "300+0" }, ratings, 1000)).toStrictEqual({
        rating: 1000,
        source: "settings",
        mode: "blitz",
        maiaModel: 1000
      });
      expect(reviewRatingFor({ timeControl: "300+0" }, ratings, null).maiaModel).toBeNull();
    });
  });

  describe("maiaCurve", () => {
    const FEN = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3";
    const move = {
      nodeId: "n5",
      ply: 5,
      san: "Bc4",
      playedMove: "f1c4",
      bestMove: "f1b5",
      fenBefore: FEN,
      fenAfter: "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3"
    } as MoveReview;
    const maia3Review = (moves: MoveReview[] = [move]) =>
      ({
        ...finished,
        maia: {
          model: "maia3",
          modelVersion: "v",
          white: { rating: 1500, source: "game" },
          black: { rating: 1500, source: "game" }
        },
        moves
      }) as GameReview;
    const curveInput = { gameId: "g", reviewId: "r", nodeId: "n5" };

    it("asks Maia 3 at every rating in one request, saves the curve into the move and returns it", async () => {
      getReview.mockReturnValue(maia3Review([{ ...move, nodeId: "n3" }, move]));
      const curve = await maiaCurve(curveInput);
      expect(maia.calls).toStrictEqual([
        {
          queries: MAIA3_RATINGS.map((rating) => ({ fen: FEN, eloSelf: rating, eloOppo: rating })),
          priority: "review"
        }
      ]);
      expect(curve.map((point) => point.rating)).toStrictEqual(MAIA3_RATINGS);
      expect(curve[0]).toMatchObject({ rating: 600, whiteWinProb: 0.5, playedRank: 15 });
      expect(curve[0].topMoves).toHaveLength(5);
      expect(saveMaiaCurve).toHaveBeenCalledWith("g", "r", {
        index: 1,
        ply: 5,
        fenAfter: move.fenAfter,
        curve
      });
    });

    it("returns a saved curve without asking Maia 3 again", async () => {
      const saved: RatingPrediction[] = MAIA3_RATINGS.map((rating) => ({
        rating,
        topMoves: [],
        whiteWinProb: 0.5
      }));
      getReview.mockReturnValue(maia3Review([{ ...move, humanPredictions: saved }]));
      await expect(maiaCurve(curveInput)).resolves.toBe(saved);
      expect(maia.calls).toStrictEqual([]);
      expect(saveMaiaCurve).not.toHaveBeenCalled();
    });

    it("computes a move's curve once while requests for it overlap", async () => {
      let release = () => {};
      maia.gate = new Promise((resolve) => (release = resolve));
      getReview.mockReturnValue(maia3Review());
      const first = maiaCurve(curveInput);
      const second = maiaCurve(curveInput);
      release();
      expect(await second).toBe(await first);
      expect(maia.calls).toHaveLength(1);
      expect(saveMaiaCurve).toHaveBeenCalledTimes(1);
    });

    it("rejects a move the analysis doesn't have, an unsaved or non-Maia-3 analysis, and a missing Maia 3", async () => {
      getReview.mockReturnValue(maia3Review());
      await expect(maiaCurve({ ...curveInput, nodeId: "n9" })).rejects.toThrow(/no such move/);
      getReview.mockReturnValue(null);
      await expect(maiaCurve(curveInput)).rejects.toThrow(/once the review has finished/);
      getReview.mockReturnValue({ ...finished, moves: [move] });
      await expect(maiaCurve(curveInput)).rejects.toThrow(/wasn't made with Maia 3/);
      getReview.mockReturnValue(maia3Review());
      maia.installed = false;
      await expect(maiaCurve(curveInput)).rejects.toThrow(/Maia 3 isn't installed/);
      expect(maia.calls).toStrictEqual([]);
    });

    it("takes only well-formed ids from the renderer", () => {
      expect(parseMaiaCurveInput({ gameId: " g ", reviewId: "r", nodeId: "n5" })).toStrictEqual({
        gameId: "g",
        reviewId: "r",
        nodeId: "n5"
      });
      expect(() => parseMaiaCurveInput({ gameId: "g", reviewId: "r" })).toThrow(/node id/);
      expect(() => parseMaiaCurveInput({ gameId: "", reviewId: "r", nodeId: "n" })).toThrow(
        /game id/
      );
      expect(() => parseMaiaCurveInput("g")).toThrow(/Maia curve/);
    });
  });
});
