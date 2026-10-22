/**
 * Commentary model guidance shared by the desktop main process (default model)
 * and the renderer settings UI (hints). Ids use OpenRouter's "vendor/model" form.
 */

/**
 * Default model for review commentary. Only applies when the user has not
 * chosen a model; a saved choice is never overridden.
 */
export const DEFAULT_COMMENTARY_MODEL = "anthropic/claude-haiku-5.5";

/**
 * Default model for reading a book's page images (book import). On a scanned opening book it
 * read the pages cleanest (about one illegal line in fifty before repair, where Gemini 3 Flash
 * left one in seven) at about half the cost; Flash-Lite-class models misread knights as bishops.
 */
export const DEFAULT_BOOK_OCR_MODEL = "anthropic/claude-haiku-5.5";

/**
 * Small/fast model families ("flash", "mini", "haiku", ...) tend to recite the
 * facts instead of coaching. UIs can use this to suggest a stronger model; it
 * never changes the user's choice.
 */
export function isLightweightCommentaryModel(model: string): boolean {
  return /(?:^|[-/:.])(?:flash|mini|nano|lite|haiku|small|tiny|8b|7b|3b|1b)(?:$|[-/:.])/i.test(
    model.trim()
  );
}
