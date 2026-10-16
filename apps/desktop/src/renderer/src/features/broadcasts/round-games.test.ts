import { describe, expect, it } from "vitest";
import type {
  BroadcastGame,
  BroadcastRoundDetail,
  BroadcastTour
} from "@chaturanga/shared/types/broadcast";
import { toggledFollow } from "./followed-players";
import { playsIn, roundGamesWhere } from "./round-games";

const player = (name: string) => ({
  name,
  title: null,
  rating: null,
  federation: null,
  fideId: null
});

const game = (id: string, white: string, black: string, result: BroadcastGame["result"]) =>
  ({
    id,
    name: `${white} - ${black}`,
    white: player(white),
    black: player(black),
    whiteClockMs: null,
    blackClockMs: null,
    fen: "8/8/8/8/8/8/8/8 w - - 0 1",
    lastMove: null,
    thinkTimeSec: null,
    result
  }) satisfies BroadcastGame;

const ROUND = {
  tour: { id: "Tour0001", name: "Open" } as BroadcastTour,
  round: {
    id: "Round001",
    name: "Round 3",
    slug: "round-3",
    url: "",
    startsAt: null,
    ongoing: true,
    finished: false
  },
  games: [
    game("Game0001", "Carlsen, Magnus", "Gukesh D", "1-0"),
    game("Game0002", "Firouzja, Alireza", "Caruana, Fabiano", "*"),
    game("Game0003", "Nakamura, Hikaru", "Gukesh D", "*")
  ]
} satisfies BroadcastRoundDetail;

describe("round games", () => {
  it("lists a followed player's games, those being played first, with where they are", () => {
    const entries = roundGamesWhere([ROUND], {}, (item) => playsIn(item, ["Gukesh D"]));
    expect(entries.map((entry) => [entry.gameId, entry.live])).toStrictEqual([
      ["Game0003", true],
      ["Game0001", false]
    ]);
    expect(entries[0]).toMatchObject({
      where: "Open · Round 3 · Board 3",
      status: "Live",
      target: { tourId: "Tour0001", roundId: "Round001", focusGameId: "Game0003" }
    });
  });

  it("follows a player, and unfollows them the second time", () => {
    expect(toggledFollow(["Gukesh D"], "Carlsen, Magnus")).toStrictEqual([
      "Gukesh D",
      "Carlsen, Magnus"
    ]);
    expect(toggledFollow(["Gukesh D", "Carlsen, Magnus"], "Gukesh D")).toStrictEqual([
      "Carlsen, Magnus"
    ]);
  });
});
