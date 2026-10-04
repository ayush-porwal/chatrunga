/**
 * The Glicko-2 rating system, as Glickman describes it in "Example of the Glicko-2 system"
 * (Boston University, 2012): ratings, deviations and volatilities in the Glicko scale (1500, 350…),
 * updated once per rating period from that period's games. Pure arithmetic — the policy (defaults,
 * bounds, what a period is) belongs to the caller (see puzzle-rating.ts).
 */

/** A player's rating (r), rating deviation (RD) and volatility (σ). */
export type Glicko2Rating = {
  rating: number;
  deviation: number;
  volatility: number;
};

/** One game of the period: the opponent's rating and RD, and the score (1 win, 0.5 draw, 0 loss). */
export type Glicko2Game = {
  opponent: { rating: number; deviation: number };
  score: number;
};

/** Glicko → Glicko-2 scale factor (400 / ln 10). */
export const GLICKO2_SCALE = 173.7178;
const BASE_RATING = 1500;
/** Convergence tolerance of the volatility iteration (step 5). */
const EPSILON = 0.000001;

const toMu = (rating: number) => (rating - BASE_RATING) / GLICKO2_SCALE;
const toPhi = (deviation: number) => deviation / GLICKO2_SCALE;

/** g(φ): how much an opponent's uncertainty discounts a game (step 3). */
function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

/** E(μ, μj, φj): the expected score against that opponent (step 3). */
function expectedScore(mu: number, muOpponent: number, phiOpponent: number): number {
  return 1 / (1 + Math.exp(-g(phiOpponent) * (mu - muOpponent)));
}

/** The player's expected score against an opponent, in the Glicko scale (0–1). */
export function glicko2ExpectedScore(
  player: Pick<Glicko2Rating, "rating">,
  opponent: Glicko2Game["opponent"]
): number {
  return expectedScore(toMu(player.rating), toMu(opponent.rating), toPhi(opponent.deviation));
}

/**
 * The player's rating after one rating period (steps 2–8). `tau` (τ) constrains how fast the
 * volatility changes (Glickman suggests 0.3–1.2). A period without games only widens the deviation
 * (step 6 alone), as the paper says.
 */
export function glicko2Update(
  player: Glicko2Rating,
  games: readonly Glicko2Game[],
  tau: number
): Glicko2Rating {
  const mu = toMu(player.rating);
  const phi = toPhi(player.deviation);
  const sigma = player.volatility;
  if (!games.length) {
    return { ...player, deviation: Math.sqrt(phi * phi + sigma * sigma) * GLICKO2_SCALE };
  }

  // Steps 3–4: the estimated variance v of the rating from the games alone, and the improvement Δ.
  let vInverse = 0;
  let improvementSum = 0;
  for (const game of games) {
    const muJ = toMu(game.opponent.rating);
    const gJ = g(toPhi(game.opponent.deviation));
    const e = expectedScore(mu, muJ, toPhi(game.opponent.deviation));
    vInverse += gJ * gJ * e * (1 - e);
    improvementSum += gJ * (game.score - e);
  }
  const v = 1 / vInverse;
  const delta = v * improvementSum;

  const nextSigma = newVolatility(phi, sigma, v, delta, tau);
  // Steps 6–7: the pre-period deviation φ*, then the new φ' and μ'.
  const phiStar = Math.sqrt(phi * phi + nextSigma * nextSigma);
  const nextPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const nextMu = mu + nextPhi * nextPhi * improvementSum;
  // Step 8: back to the Glicko scale.
  return {
    rating: GLICKO2_SCALE * nextMu + BASE_RATING,
    deviation: GLICKO2_SCALE * nextPhi,
    volatility: nextSigma
  };
}

/** Step 5: the new volatility σ', the root of f(x) found by the Illinois algorithm. */
function newVolatility(phi: number, sigma: number, v: number, delta: number, tau: number): number {
  const a = Math.log(sigma * sigma);
  const deltaSquared = delta * delta;
  const phiSquared = phi * phi;
  const f = (x: number) => {
    const ex = Math.exp(x);
    const denominator = phiSquared + v + ex;
    return (
      (ex * (deltaSquared - phiSquared - v - ex)) / (2 * denominator * denominator) -
      (x - a) / (tau * tau)
    );
  };

  let A = a;
  let B: number;
  if (deltaSquared > phiSquared + v) {
    B = Math.log(deltaSquared - phiSquared - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) k += 1;
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  // Bounded: the bracket halves at least every other step, so this ends long before the cap.
  for (let iteration = 0; Math.abs(B - A) > EPSILON && iteration < 1000; iteration += 1) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  return Math.exp(A / 2);
}
