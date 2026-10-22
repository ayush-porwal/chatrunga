/**
 * What importing a book will roughly cost and take, from its page count and the two models'
 * prices. The per-page token counts were measured on a scanned opening book with Haiku 5.5
 * reading 300 dpi pages and structuring them (about $0.002 a page to read, $0.004 to structure,
 * thinking included); time assumes reading four pages at once and four chapters' lines at once.
 */
import { DEFAULT_BOOK_OCR_MODEL, DEFAULT_COMMENTARY_MODEL } from "../llm/models";

/** USD per token (prompt, completion) and per image, as OpenRouter lists them. */
export type ModelPrice = { prompt: number; completion: number; image: number };

/** Prices used when OpenRouter's model list can't be read. */
export const FALLBACK_MODEL_PRICES: Readonly<Partial<Record<string, ModelPrice>>> =
  Object.fromEntries(
    // Both defaults are Claude Haiku 5.5 today; listed apart so changing one keeps a price for it.
    [DEFAULT_BOOK_OCR_MODEL, DEFAULT_COMMENTARY_MODEL].map((model) => [
      model,
      { prompt: 0.1e-6, completion: 0.5e-6, image: 0 }
    ])
  );
/** For a model the fallback list doesn't know: priced like a mid-range model. */
export const UNKNOWN_MODEL_PRICE: ModelPrice = { prompt: 3e-6, completion: 15e-6, image: 0 };

/** A 300 dpi page image is about 5,000 prompt tokens; completions include thinking. */
const OCR = { prompt: 5_200, completion: 2_400, images: 1 };
const LINES = { prompt: 3_000, completion: 7_000, images: 0 };
const REPAIR = { prompt: 13_000, completion: 1_500, images: 2 };
/** Repairs per page (one per root error: a few per chapter once pages are read cleanly). */
const REPAIRS_PER_PAGE = 0.15;
const OUTLINE = { prompt: 15_000, completion: 1_000, images: 0 };
/** Seconds per page with the import's concurrency (reading, then lines). */
const SECONDS_PER_PAGE = 2.5 + 7.5;

type Call = { prompt: number; completion: number; images: number };

function callCost(call: Call, price: ModelPrice): number {
  return (
    call.prompt * price.prompt + call.completion * price.completion + call.images * price.image
  );
}

/** Cost (USD) and time (minutes) for `pageCount` pages. */
export function estimateBookImport(input: {
  pageCount: number;
  ocrPrice: ModelPrice;
  structurePrice: ModelPrice;
}): { costUsd: number; minutes: number } {
  const pages = Math.max(0, input.pageCount);
  const perPage =
    callCost(OCR, input.ocrPrice) +
    callCost(LINES, input.structurePrice) +
    REPAIRS_PER_PAGE * callCost(REPAIR, input.structurePrice);
  const costUsd = pages * perPage + (pages ? callCost(OUTLINE, input.structurePrice) : 0);
  return {
    costUsd: Math.round(costUsd * 100) / 100,
    minutes: Math.max(1, Math.ceil((pages * SECONDS_PER_PAGE) / 60))
  };
}
