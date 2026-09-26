/**
 * Commentary model guidance shared by the desktop main process (default model)
 * and the renderer settings UI (hints). Ids use OpenRouter's "vendor/model" form.
 */

/**
 * Default model for review commentary. Claude Sonnet writes natural coaching
 * prose while following the grounding rules. Only applies when the user has
 * not chosen a model; a saved choice is never overridden.
 */
export const DEFAULT_COMMENTARY_MODEL = "anthropic/claude-sonnet-4.6";

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
