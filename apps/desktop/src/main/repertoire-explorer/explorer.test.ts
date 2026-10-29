import { rmSync } from "node:fs";
import { afterAll, describe, expect, it, vi } from "vitest";
import { fenAfterUci, START_FEN } from "@chaturanga/shared/chess/position";
import type { Maia3Query } from "@chaturanga/shared/engine/maia3";
import { uniformRatings, type PlayerRatings } from "@chaturanga/shared/types/ratings";
import { serviceHelpers } from "../repertoire/__fixtures__/repertoire-builders";

const env = await vi.hoisted(async () => import("../repertoire/__fixtures__/service-env"));
vi.mock("electron", () => env.electronModule);

const { closeDb } = await import("../db");
const service = await import("../repertoire/service");
const { defaultRating, explorerMaiaMoves, likelyMoves } = await import("./explorer");
const { create, save } = serviceHelpers(service);

describe("Maia's likely moves", () => {
  afterAll(() => {
    closeDb();
    rmSync(env.userData, { recursive: true, force: true });
  });

  it("lists the likeliest moves until they cover 90% of the weight, at most 8", () => {
    expect(
      likelyMoves({ e2e4: 0.5, d2d4: 0.3, c2c4: 0.15, g1f3: 0.05 }).map((move) => move.uci)
    ).toStrictEqual(["e2e4", "d2d4", "c2c4"]);
    const flat = Object.fromEntries(
      ["a2a3", "b2b3", "c2c3", "d2d3", "e2e3", "f2f3", "g2g3", "h2h3", "a2a4", "b2b4"].map(
        (uci) => [uci, 0.1]
      )
    );
    expect(likelyMoves(flat)).toHaveLength(8);
  });

  it("reads Maia at the user's rating: Settings when set, else their recent games, else 1500", () => {
    const ratings: PlayerRatings = uniformRatings(1720);
    expect(defaultRating("blitz", ratings, true, [1400])).toStrictEqual({
      rating: 1720,
      source: "settings"
    });
    expect(defaultRating("blitz", ratings, false, [1400, 1600, 1500])).toStrictEqual({
      rating: 1500,
      source: "games"
    });
    expect(defaultRating("blitz", ratings, false, [])).toStrictEqual({
      rating: 1500,
      source: "default"
    });
  });

  it("marks the repertoire's moves and says when the opponent is to move", async () => {
    const { id } = create();
    save(id, [["e2e4", "e7e5", "g1f3"]]);
    const afterE4 = fenAfterUci(START_FEN, "e2e4")!;
    const queries: Maia3Query[] = [];
    const maia = {
      isInstalled: () => true,
      evaluate: (asked: readonly Maia3Query[]) => {
        queries.push(...asked);
        return Promise.resolve([{ policy: { e7e5: 0.6, c7c5: 0.35, a7a6: 0.05 }, value: 0.5 }]);
      }
    };
    const ratingDeps = { playerRatings: () => uniformRatings(1640), ratingsSet: () => true };
    const answer = await explorerMaiaMoves(
      { repertoireId: id, fen: afterE4, rating: null, mode: "blitz" },
      maia,
      ratingDeps
    );
    expect(answer).toStrictEqual({
      installed: true,
      // On Maia 3's grid.
      rating: 1600,
      mode: "blitz",
      defaultRating: 1600,
      ratingSource: "settings",
      opponentToMove: true,
      moves: [
        { uci: "e7e5", san: "e5", probability: 0.6, inRepertoire: true },
        { uci: "c7c5", san: "c5", probability: 0.35, inRepertoire: false }
      ]
    });
    expect(queries).toStrictEqual([{ fen: afterE4, eloSelf: 1600, eloOppo: 1600 }]);

    // A rating picked in the explorer; and without the model nothing is asked.
    await explorerMaiaMoves(
      { repertoireId: id, fen: afterE4, rating: 1900, mode: "blitz" },
      maia,
      ratingDeps
    );
    expect(queries.at(-1)?.eloSelf).toBe(1900);
    expect(
      await explorerMaiaMoves(
        { repertoireId: id, fen: afterE4, rating: null, mode: null },
        { ...maia, isInstalled: () => false },
        ratingDeps
      )
    ).toStrictEqual({ installed: false });
  });
});
