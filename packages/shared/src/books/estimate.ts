/**
 * What importing a book will roughly cost and take, from its page count and the two models'
 * prices. The per-page token counts were measured on a scanned opening book (about $0.003 a page
 * to read and $0.005 to structure); time assumes reading four pages at once and four chapters'
 * lines at once.
 */
import { DEFAULT_BOOK_OCR_MODEL, DEFAULT_COMMENTARY_MODEL } from "../llm/models";

/** USD per token (prompt, completion) and per image, as OpenRouter lists them. */
export type ModelPrice = { prompt: number; completion: number; image: number };

/** Prices used when OpenRouter's model list can't be read. */
export const FALLBACK_MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  [DEFAULT_BOOK_OCR_MODEL]: { prompt: 0.5e-6, completion: 3e-6, image: 0 },
  [DEFAULT_COMMENTARY_MODEL]: { prompt: 1e-6, completion: 5e-6, image: 0 }
};
/** For a model the fallback list doesn't know: priced like a mid-range model. */
export const UNKNOWN_MODEL_PRICE: ModelPrice = { prompt: 3e-6, completion: 15e-6, image: 0 };

const OCR = { prompt: 1_800, completion: 900, images: 1 };
const LINES = { prompt: 2_500, completion: 800, images: 0 };
const REPAIR = { prompt: 3_500, completion: 500, images: 2 };
/** Repairs per page (about one line in ten is illegal at first). */
const REPAIRS_PER_PAGE = 0.3;
const OUTLINE = { prompt: 15_000, completion: 1_000, images: 0 };
/** Seconds per page with the import's concurrency (reading, then lines). */
const SECONDS_PER_PAGE = 3.75 + 5;

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
