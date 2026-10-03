import { describe, expect, it } from "vitest";
import { glicko2ExpectedScore, glicko2Update, type Glicko2Game } from "./glicko2";

// Glickman, "Example of the Glicko-2 system" (2012), worked example: a 1500 / 200 / 0.06 player
// beats a 1400 / 30 player and loses to 1550 / 100 and 1700 / 300, with τ = 0.5.
const PLAYER = { rating: 1500, deviation: 200, volatility: 0.06 };
const GAMES: Glicko2Game[] = [
  { opponent: { rating: 1400, deviation: 30 }, score: 1 },
  { opponent: { rating: 1550, deviation: 100 }, score: 0 },
  { opponent: { rating: 1700, deviation: 300 }, score: 0 }
];

describe("glicko2Update", () => {
  it("reproduces Glickman's worked example", () => {
    const next = glicko2Update(PLAYER, GAMES, 0.5);
    // The paper's results: r' = 1464.06, RD' = 151.52, σ' = 0.05999.
    expect(next.rating).toBeCloseTo(1464.06, 1);
    expect(next.deviation).toBeCloseTo(151.52, 1);
    // The paper truncates σ' (0.059996…) to 0.05999.
    expect(next.volatility).toBeCloseTo(0.05999, 4);
  });

  it("matches the example's expected scores", () => {
    // E = 0.639, 0.432, 0.303 in the paper.
    expect(glicko2ExpectedScore(PLAYER, GAMES[0].opponent)).toBeCloseTo(0.639, 3);
    expect(glicko2ExpectedScore(PLAYER, GAMES[1].opponent)).toBeCloseTo(0.432, 3);
    expect(glicko2ExpectedScore(PLAYER, GAMES[2].opponent)).toBeCloseTo(0.303, 3);
  });

  it("only widens the deviation over a period without games", () => {
    const next = glicko2Update(PLAYER, [], 0.5);
    expect(next.rating).toBe(1500);
    expect(next.volatility).toBe(0.06);
    // φ* = √(φ² + σ²) = √(1.1513² + 0.06²) → 200.5 in the Glicko scale.
    expect(next.deviation).toBeCloseTo(Math.sqrt((200 / 173.7178) ** 2 + 0.06 ** 2) * 173.7178, 6);
  });

  it("moves the rating up on a win and down on a loss, by the same amount against an equal opponent", () => {
    const equal = { opponent: { rating: 1500, deviation: 200 }, score: 1 };
    const win = glicko2Update(PLAYER, [equal], 0.5);
    const loss = glicko2Update(PLAYER, [{ ...equal, score: 0 }], 0.5);
    expect(win.rating).toBeGreaterThan(1500);
    expect(loss.rating).toBeLessThan(1500);
    expect(win.rating - 1500).toBeCloseTo(1500 - loss.rating, 6);
    expect(win.deviation).toBeLessThan(200);
  });

  it("takes the large-Δ branch of the volatility iteration (Δ² > φ² + v)", () => {
    // A settled player who beats a far stronger, settled opponent: a big surprise.
    const next = glicko2Update({ rating: 1500, deviation: 50, volatility: 0.06 }, [{ opponent: { rating: 2600, deviation: 50 }, score: 1 }], 0.5);
    expect(next.volatility).toBeGreaterThan(0.06);
    expect(Number.isFinite(next.rating)).toBe(true);
    expect(next.rating).toBeGreaterThan(1500);
  });
});
