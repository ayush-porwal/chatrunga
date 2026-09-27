import { useState } from "react";
import { useOpenRouterConfigQuery } from "../../queries/api";

export type OpenRouterSaveState = { kind: "idle" | "saving" | "saved" | "error"; message?: string };

/**
 * Saving the OpenRouter model / API key (Settings → Commentary, Review settings and the welcome).
 * The key goes straight over the preload IPC boundary to main, which encrypts it; nothing here
 * keeps it after the call, and it is never read back (only `hasApiKey`).
 */
export function useOpenRouterSave() {
  const config = useOpenRouterConfigQuery();
  const [saveState, setSaveState] = useState<OpenRouterSaveState>({ kind: "idle" });

  async function run(
    input: { model?: string; apiKey?: string | null },
    savedMessage: string,
    failMessage: string
  ): Promise<boolean> {
    if (!window.chaturanga) {
      setSaveState({
        kind: "error",
        message: "OpenRouter settings are available in the desktop app."
      });
      return false;
    }
    setSaveState({ kind: "saving" });
    try {
      await window.chaturanga.commentary.setOpenRouterConfig(input);
      setSaveState({ kind: "saved", message: savedMessage });
      await config.refetch();
      return true;
    } catch (error) {
      setSaveState({
        kind: "error",
        message: error instanceof Error ? error.message : failMessage
      });
      return false;
    }
  }

  return {
    config,
    hasApiKey: Boolean(config.data?.hasApiKey),
    saveState,
    /** Saves the model and, when non-blank, a new key. Resolves true on success. */
    save: ({ model, apiKey }: { model?: string; apiKey?: string }) =>
      run(
        {
          ...(model !== undefined ? { model } : {}),
          ...(apiKey?.trim() ? { apiKey: apiKey.trim() } : {})
        },
        "Saved.",
        "Could not save OpenRouter settings."
      ),
    /** Removes the saved key. */
    clearKey: (model?: string) =>
      run(
        { apiKey: null, ...(model !== undefined ? { model } : {}) },
        "Key removed.",
        "Could not remove the saved key."
      )
  };
}

/** Where OpenRouter API keys are created (opened in the browser; external links leave the app). */
export const OPENROUTER_KEYS_URL = "https://openrouter.ai/keys";
