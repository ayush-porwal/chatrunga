import { describe, expect, it } from "vitest";
import { START_FEN } from "@chaturanga/shared/chess/position";
import {
  assertRapidOrSlower,
  estimatedGameSeconds,
  eventFromStream,
  isFinalStatus,
  normalizeAccount,
  normalizeChallenge,
  normalizeGameFull,
  normalizeGameState
} from "./normalize";

// Shapes from the Lichess API spec examples.
const GAME_FULL = {
  id: "xcoxhDvh",
  variant: { key: "standard", name: "Standard", short: "Std" },
  speed: "rapid",
  perf: { name: "Rapid" },
  rated: false,
  createdAt: 1789845859939,
  white: { id: "kenneth", name: "Kenneth", title: null, rating: 804 },
  black: { aiLevel: 3 },
  initialFen: "startpos",
  clock: { initial: 600000, increment: 5000 },
  type: "gameFull",
  state: {
    type: "gameState",
    moves: "",
    wtime: 600000,
    btime: 600000,
    winc: 5000,
    binc: 5000,
    status: "started"
  }
};

const CHALLENGE = {
  id: "iOskobMC",
  url: "https://lichess.org/iOskobMC",
  status: "created",
  challenger: { name: "Adriana", id: "adriana", rating: 1548, title: "WFM", provisional: true },
  destUser: { name: "Gabriela", id: "gabriela", rating: 1459, online: true },
  variant: { key: "standard", name: "Standard", short: "Std" },
  rated: true,
  speed: "rapid",
  timeControl: { type: "clock", limit: 600, increment: 5, show: "10+5" },
  color: "white",
  finalColor: "white",
  perf: { icon: "", name: "Rapid" }
};

describe("normalizeGameFull", () => {
  it("maps players, clock, the start position and the state", () => {
    expect(normalizeGameFull(GAME_FULL)).toEqual({
      id: "xcoxhDvh",
      rated: false,
      speed: "rapid",
      clock: { initialMs: 600000, incrementMs: 5000 },
      white: { id: "kenneth", name: "Kenneth", rating: 804, title: null, aiLevel: null },
      black: { id: null, name: "Stockfish level 3", rating: null, title: null, aiLevel: 3 },
      initialFen: START_FEN,
      state: {
        moves: [],
        wtime: 600000,
        btime: 600000,
        winc: 5000,
        binc: 5000,
        status: "started",
        winner: null,
        drawOffer: null
      },
      createdAt: 1789845859939
    });
  });

  it("keeps a custom FEN and has no clock for correspondence", () => {
    const fen = "8/8/8/4k3/8/8/4K3/7R w - - 0 1";
    const game = normalizeGameFull({
      ...GAME_FULL,
      speed: "correspondence",
      clock: undefined,
      initialFen: fen
    });
    expect(game.clock).toBeNull();
    expect(game.initialFen).toBe(fen);
    expect(game.speed).toBe("correspondence");
  });

  it("requires an id", () => {
    expect(() => normalizeGameFull({ ...GAME_FULL, id: undefined })).toThrow();
  });
});

describe("normalizeGameState", () => {
  it("splits moves and reads draw offers and the winner", () => {
    expect(
      normalizeGameState({
        type: "gameState",
        moves: "e2e4 e7e5 g1f3",
        wtime: 1000,
        btime: 2000,
        winc: 0,
        binc: 0,
        status: "started",
        bdraw: true
      })
    ).toMatchObject({ moves: ["e2e4", "e7e5", "g1f3"], drawOffer: "black", winner: null });
    expect(
      normalizeGameState({ moves: "e2e4", status: "resign", winner: "white", wdraw: true })
    ).toMatchObject({
      moves: ["e2e4"],
      winner: "white",
      drawOffer: "white",
      wtime: 0
    });
  });

  it("knows which statuses are final", () => {
    expect(isFinalStatus("started")).toBe(false);
    expect(isFinalStatus("created")).toBe(false);
    for (const status of ["mate", "resign", "aborted", "outoftime", "draw", "variantEnd"]) {
      expect(isFinalStatus(status)).toBe(true);
    }
  });
});

describe("normalizeChallenge", () => {
  it("sees an incoming challenge from the challenged side", () => {
    expect(normalizeChallenge(CHALLENGE, "gabriela")).toEqual({
      id: "iOskobMC",
      direction: "in",
      opponent: { id: "adriana", name: "Adriana", rating: 1548, title: "WFM", aiLevel: null },
      rated: true,
      speed: "rapid",
      timeControl: { minutes: 10, incrementSec: 5 },
      yourColor: "black"
    });
  });

  it("sees your own challenge as outgoing, with your picked color", () => {
    expect(normalizeChallenge(CHALLENGE, "adriana")).toMatchObject({
      direction: "out",
      opponent: { id: "gabriela", name: "Gabriela" },
      yourColor: "white"
    });
  });

  it("prefers Lichess's direction and handles unlimited and open challenges", () => {
    const challenge = normalizeChallenge(
      {
        ...CHALLENGE,
        direction: "out",
        destUser: null,
        color: "random",
        timeControl: { type: "unlimited" }
      },
      "someone-else"
    );
    expect(challenge).toMatchObject({ direction: "out", yourColor: "random", timeControl: null });
    expect(challenge.opponent.name).toBe("Open challenge");
  });
});

describe("eventFromStream", () => {
  it("maps game starts, challenges and their end; ignores game finishes", () => {
    expect(
      eventFromStream(
        { type: "gameStart", game: { gameId: "YfjTIV43", fullId: "YfjTIV43miXK" } },
        "me"
      )
    ).toEqual({
      type: "gameStart",
      gameId: "YfjTIV43"
    });
    expect(eventFromStream({ type: "challenge", challenge: CHALLENGE }, "gabriela")).toMatchObject({
      type: "challenge",
      challenge: { id: "iOskobMC", direction: "in" }
    });
    expect(eventFromStream({ type: "challengeDeclined", challenge: CHALLENGE }, "adriana")).toEqual(
      {
        type: "challengeGone",
        challengeId: "iOskobMC",
        reason: "declined"
      }
    );
    expect(
      eventFromStream({ type: "challengeCanceled", challenge: CHALLENGE }, "gabriela")
    ).toMatchObject({
      reason: "canceled"
    });
    expect(eventFromStream({ type: "gameFinish", game: { gameId: "YfjTIV43" } }, "me")).toBeNull();
    expect(eventFromStream({ type: "somethingNew" }, "me")).toBeNull();
  });
});

describe("normalizeAccount", () => {
  it("keeps the standard speeds' ratings", () => {
    expect(
      normalizeAccount(
        {
          id: "georges",
          username: "Georges",
          title: "FM",
          perfs: {
            blitz: { games: 12, rating: 1800, rd: 60, prog: 5 },
            rapid: { games: 3, rating: 1500, rd: 150, prog: 0, prov: true },
            atomic: { games: 1, rating: 1500, rd: 300, prog: 0 },
            storm: { runs: 1, score: 10 }
          }
        },
        1000
      )
    ).toEqual({
      id: "georges",
      username: "Georges",
      title: "FM",
      perfs: {
        blitz: { rating: 1800, games: 12, provisional: false },
        rapid: { rating: 1500, games: 3, provisional: true }
      },
      connectedAt: 1000,
      lastSyncAt: null
    });
  });

  it("requires a username", () => {
    expect(() => normalizeAccount({ id: "x" }, 0)).toThrow(/username/);
  });
});

describe("rapid-or-slower rule", () => {
  it("uses Lichess's estimate: time + 40 × increment ≥ 8 minutes", () => {
    expect(estimatedGameSeconds(10, 0)).toBe(600);
    expect(() => assertRapidOrSlower(10, 0)).not.toThrow();
    expect(() => assertRapidOrSlower(8, 0)).not.toThrow();
    expect(() => assertRapidOrSlower(5, 5)).not.toThrow();
    expect(() => assertRapidOrSlower(30, 20)).not.toThrow();
    expect(() => assertRapidOrSlower(5, 3)).toThrow(/Rapid or slower/);
    expect(() => assertRapidOrSlower(3, 2)).toThrow(/Rapid or slower/);
    expect(() => assertRapidOrSlower(7.5, 0)).toThrow(/Rapid or slower/);
  });
});
