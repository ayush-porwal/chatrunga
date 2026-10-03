import { describe, expect, it } from "vitest";
import type { LichessGameFull } from "@chaturanga/shared/types/lichess";
import { clockLabel, lichessGameLabel, lichessHeaders, lichessOutcome, sideToMoveAfter, speedForClock, yourColor } from "./lichess-game";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const game: LichessGameFull = {
  id: "abcd1234",
  variant: "standard",
  rated: true,
  speed: "rapid",
  clock: { initialMs: 600_000, incrementMs: 5_000 },
  white: { id: "ayush", name: "Ayush", rating: 1840, title: null, aiLevel: null },
  black: { id: "knightrider", name: "knightrider", rating: 1872, title: "FM", aiLevel: null },
  initialFen: START,
  state: { moves: [], wtime: 600_000, btime: 600_000, winc: 5_000, binc: 5_000, status: "started", winner: null, drawOffer: null },
  createdAt: new Date(2026, 8, 27).getTime()
};

describe("lichess game helpers", () => {
  it("labels the kind of game: rated or casual, speed and clock", () => {
    expect(lichessGameLabel(game)).toBe("Rated · Rapid · 10+5");
    expect(lichessGameLabel({ ...game, rated: false, speed: "correspondence", clock: null })).toBe("Casual · Correspondence");
    expect(clockLabel({ initialMs: 30_000, incrementMs: 0 })).toBe("½+0");
    expect(clockLabel({ initialMs: 90_000, incrementMs: 1_000 })).toBe("1.5+1");
  });

  it("finds your side from your account id", () => {
    expect(yourColor(game, "ayush")).toBe("white");
    expect(yourColor(game, "knightrider")).toBe("black");
    expect(yourColor(game, "someone")).toBeNull();
  });

  it("maps Lichess statuses to results and terminations", () => {
    expect(lichessOutcome({ status: "started", winner: null })).toBeNull();
    expect(lichessOutcome({ status: "mate", winner: "white" })).toEqual({ result: "1-0", termination: "Checkmate" });
    expect(lichessOutcome({ status: "resign", winner: "black" })).toEqual({ result: "0-1", termination: "Player resign" });
    expect(lichessOutcome({ status: "outoftime", winner: "white" })).toEqual({ result: "1-0", termination: "Time forfeit" });
    expect(lichessOutcome({ status: "draw", winner: null })).toEqual({ result: "1/2-1/2", termination: "Draw" });
    expect(lichessOutcome({ status: "aborted", winner: null })).toEqual({ result: "*", termination: "Game aborted" });
  });

  it("works out the side to move from the start position and move count", () => {
    expect(sideToMoveAfter(START, 0)).toBe("white");
    expect(sideToMoveAfter(START, 3)).toBe("black");
    expect(sideToMoveAfter("4k3/8/8/8/8/8/8/4K3 b - - 0 1", 1)).toBe("white");
  });

  it("writes headers that identify the game on import", () => {
    expect(lichessHeaders(game)).toMatchObject({
      event: "Rated Rapid game",
      site: "https://lichess.org/abcd1234",
      date: "2026.09.27",
      white: "Ayush",
      black: "FM knightrider",
      whiteElo: "1840",
      timeControl: "600+5",
      result: "*"
    });
  });

  it("sorts clocks into speeds the way Lichess does", () => {
    expect(speedForClock(1, 0)).toBe("bullet");
    expect(speedForClock(5, 3)).toBe("blitz");
    expect(speedForClock(10, 0)).toBe("rapid");
    expect(speedForClock(30, 0)).toBe("classical");
    // 5+5 is estimated at 8:20: rapid, so the lobby takes it.
    expect(speedForClock(5, 5)).toBe("rapid");
  });
});
