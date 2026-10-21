import { describe, expect, it, vi } from "vitest";
import { FALLBACK_MODEL_PRICES, UNKNOWN_MODEL_PRICE } from "@chaturanga/shared/books/estimate";
import { DEFAULT_BOOK_OCR_MODEL } from "@chaturanga/shared/llm/models";
import { modelPrices, parseModelPrices } from "./model-prices";

const LIST = {
  data: [
    { id: "vision/model", pricing: { prompt: "0.000001", completion: "0.000004", image: "0.002" } },
    { id: "text/model", pricing: { prompt: "0.000002", completion: "0.00001" } },
    { id: "broken/model", pricing: { prompt: "free" } },
    { id: 7 }
  ]
};

describe("model prices", () => {
  it("reads usable prices from OpenRouter's model list", () => {
    expect([...parseModelPrices(LIST)]).toStrictEqual([
      ["vision/model", { prompt: 0.000001, completion: 0.000004, image: 0.002 }],
      ["text/model", { prompt: 0.000002, completion: 0.00001, image: 0 }]
    ]);
    expect(parseModelPrices({ data: "none" }).size).toBe(0);
  });

  it("asks OpenRouter at most once a day", async () => {
    let now = 0;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(LIST)));
    const prices = modelPrices({ fetchImpl, now: () => now });
    await expect(prices.pricesFor(["vision/model", "text/model"])).resolves.toMatchObject({
      source: "live",
      prices: [{ image: 0.002 }, { prompt: 0.000002 }]
    });
    await prices.pricesFor(["vision/model"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now = 25 * 60 * 60_000;
    await prices.pricesFor(["vision/model"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("falls back to built-in prices offline or for a model the list lacks", async () => {
    const offline = modelPrices({
      fetchImpl: vi.fn(async () => {
        throw new TypeError("offline");
      })
    });
    await expect(offline.pricesFor([DEFAULT_BOOK_OCR_MODEL, "new/model"])).resolves.toStrictEqual({
      source: "fallback",
      prices: [FALLBACK_MODEL_PRICES[DEFAULT_BOOK_OCR_MODEL], UNKNOWN_MODEL_PRICE]
    });
    const partial = modelPrices({
      fetchImpl: vi.fn(async () => new Response(JSON.stringify(LIST)))
    });
    await expect(partial.pricesFor(["vision/model", "new/model"])).resolves.toMatchObject({
      source: "fallback"
    });
  });
});
