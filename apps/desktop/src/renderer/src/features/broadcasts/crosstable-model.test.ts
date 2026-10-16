import { describe, expect, it } from "vitest";
import type {
  BroadcastGame,
  BroadcastRoundDetail,
  BroadcastStanding,
  BroadcastTour
} from "@chaturanga/shared/types/broadcast";
import { crosstable, type CrossCell } from "./crosstable-model";

const person = (name: string) => ({
  name,
  title: null,
  rating: null,
  federation: null,
  fideId: null
});

const standing = (name: string): BroadcastStanding => ({
  ...person(name),
  rank: null,
  score: null,
  played: null,
  performance: null,
  ratingDiff: null
});

const game = (white: string, black: string, result: BroadcastGame["result"]): BroadcastGame => ({
  id: `${white}${black}`,
  name: "",
  white: person(white),
  black: person(black),
  whiteClockMs: null,
  blackClockMs: null,
  fen: "",
  lastMove: null,
  thinkTimeSec: null,
  result
});

const round = (games: BroadcastGame[]): BroadcastRoundDetail => ({
  tour: { id: "Tour0001" } as BroadcastTour,
  round: {
    id: "Round001",
    name: "",
    slug: "",
    url: "",
    startsAt: null,
    ongoing: false,
    finished: true
  },
  games
});

/** A cell as a crosstable prints it: colour, opponent's place, score ("w2 1"); "-" for none. */
function cellText(cell: CrossCell | null): string {
  if (!cell) return "-";
  return `${cell.color[0]}${cell.opponent ?? "?"} ${cell.score ?? "*"}`;
}

describe("crosstable", () => {
  it("gives each player their game of every round, from their side, opponents by place", () => {
    const rows = crosstable(
      [standing("A"), standing("B"), standing("C")],
      [round([game("A", "B", "1-0")]), round([game("C", "A", "½-½"), game("B", "X", "*")]), null]
    );
    const view = rows.map((row) => row.cells.map(cellText));
    expect(view).toStrictEqual([
      ["w2 1", "b3 ½", "-"],
      ["b1 0", "w? *", "-"],
      ["-", "w1 ½", "-"]
    ]);
    // A game that ended since its round was read: the stream's result.
    const live = crosstable([standing("B")], [round([game("B", "X", "*")])], {
      BX: { result: "0-1" }
    });
    expect(live[0]?.cells.map(cellText)).toStrictEqual(["w? 0"]);
  });
});
