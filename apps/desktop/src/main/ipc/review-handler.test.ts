import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "@chaturanga/shared/types/settings";
import type { EngineConfig, GameReview, ReviewGameInput } from "@chaturanga/shared/types/engine";
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

vi.mock("../db/repositories", () => ({
  settingsRepository: { getAll: () => ({ ...defaultSettings, reviewUseMaia: false }) }
}));
vi.mock("../engine/engine-config", () => ({
  engineConfigForId: (id: string) => (id === "sf" ? engine : null),
  engineResourceOptions: () => ({ threads: 1, hashMb: 16 }),
  listAllEngines: () => [engine]
}));
const reviewGameWithEngine = vi.fn();
vi.mock("../engine/review", () => ({
  reviewGameWithEngine: (...args: unknown[]) => reviewGameWithEngine(...args)
}));

const { reviewRatingFor, runGameReview } = await import("./review-handler");
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
});

describe("runGameReview analytics", () => {
  it("reviewing one game three times is three operations on one game", async () => {
    reviewGameWithEngine.mockResolvedValue(finished);
    const manager = fakeManager();
    const results = [];
    for (const id of ["r1", "r2", "r3"])
      results.push(await runGameReview(manager as never, input(id)));
    // The operation id is kept with the review, so opening it later is attributable.
    expect(results.map((review) => review.reviewId)).toEqual(["r1", "r2", "r3"]);

    const completed = events().filter((event) => event.event === "review_completed");
    expect(completed.map((event) => event.review_id)).toEqual(["r1", "r2", "r3"]);
    expect(new Set(completed.map((event) => event.game_ref)).size).toBe(1);
    expect(completed[0]).toMatchObject({
      engine_family: "stockfish",
      ply_count: 0,
      maia_levels: 0
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
    expect(terminal.map((event) => [event.event, event.review_id])).toEqual([
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
    await expect(runGameReview(fakeManager() as never, input("r-ok", null))).resolves.toMatchObject(
      { reviewId: "r-ok" }
    );
  });
});

describe("the rating a review is made for", () => {
  it("is the game's own rating for the reviewed side, passed to the engine and saved with the review", async () => {
    reviewGameWithEngine.mockResolvedValue(finished);
    const review = await runGameReview(fakeManager() as never, {
      ...input("r-rated"),
      timeControl: "180+2",
      rating: { side: "black", whiteElo: 2010, blackElo: 1533, speed: null }
    });
    expect(reviewGameWithEngine.mock.lastCall?.[4]).toMatchObject({ playerRating: 1533 });
    // This profile runs no Maia (reviewUseMaia off), so no model is named.
    expect(review.rating).toEqual({ rating: 1533, source: "game", mode: "blitz", maiaModel: null });
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

describe("reviewRatingFor", () => {
  it("rounds to the nearest Maia level the review runs", () => {
    const settings = {
      reviewPlayerColor: "white" as const,
      playerRatings: {
        ...defaultSettings.playerRatings,
        blitz: { source: "manual" as const, rating: 1000 }
      }
    };
    expect(
      reviewRatingFor({ timeControl: "300+0" }, settings, [
        { maiaRating: 1100 },
        { maiaRating: 1500 }
      ])
    ).toEqual({ rating: 1000, source: "settings", mode: "blitz", maiaModel: 1100 });
  });
});
