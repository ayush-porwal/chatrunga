/**
 * Model prices for the book import's estimate, from OpenRouter's public model list
 * (GET /api/v1/models, no key needed), kept for a day. Offline, or for a model the list doesn't
 * have, the built-in prices stand in (estimate.ts).
 */
import {
  FALLBACK_MODEL_PRICES,
  UNKNOWN_MODEL_PRICE,
  type ModelPrice
} from "@chaturanga/shared/books/estimate";
import { isRecord } from "@chaturanga/shared/types/guards";

const MODELS_URL = "https://openrouter.ai/api/v1/models";
const CACHE_MS = 24 * 60 * 60_000;
const TIMEOUT_MS = 10_000;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** A price field as OpenRouter writes it ("0.0000005", USD per token); null when unusable. */
function price(value: unknown): number | null {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) && number >= 0 ? number : null;
}

/** Each listed model's prices, by id (models without usable prices are left out). */
export function parseModelPrices(body: unknown): Map<string, ModelPrice> {
  const prices = new Map<string, ModelPrice>();
  const models = isRecord(body) && Array.isArray(body.data) ? body.data : [];
  for (const model of models) {
    if (!isRecord(model) || typeof model.id !== "string" || !isRecord(model.pricing)) continue;
    const prompt = price(model.pricing.prompt);
    const completion = price(model.pricing.completion);
    if (prompt === null || completion === null) continue;
    prices.set(model.id, { prompt, completion, image: price(model.pricing.image) ?? 0 });
  }
  return prices;
}

/** Prices by model id, read from OpenRouter at most once a day. */
export function modelPrices(options: { fetchImpl?: FetchLike; now?: () => number } = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  let cached: { at: number; prices: Map<string, ModelPrice> } | null = null;

  async function live(): Promise<Map<string, ModelPrice> | null> {
    if (cached && now() - cached.at < CACHE_MS) return cached.prices;
    try {
      const response = await fetchImpl(MODELS_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) return null;
      const prices = parseModelPrices(await response.json());
      if (!prices.size) return null;
      cached = { at: now(), prices };
      return prices;
    } catch {
      return null;
    }
  }

  return {
    /** Both models' prices, and whether they came from OpenRouter (all of them). */
    async pricesFor(
      models: readonly string[]
    ): Promise<{ prices: ModelPrice[]; source: "live" | "fallback" }> {
      const listed = await live();
      const found = models.map((model) => listed?.get(model));
      return {
        prices: found.map(
          (live, index) => live ?? FALLBACK_MODEL_PRICES[models[index]] ?? UNKNOWN_MODEL_PRICE
        ),
        source: found.every(Boolean) ? "live" : "fallback"
      };
    }
  };
}
