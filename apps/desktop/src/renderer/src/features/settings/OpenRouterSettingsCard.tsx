import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import {
  DEFAULT_COMMENTARY_MODEL,
  isLightweightCommentaryModel
} from "@chaturanga/shared/llm/models";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { fieldHint } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { OPENROUTER_KEYS_URL, useOpenRouterSave } from "./use-openrouter-save";

/**
 * Shared BYOK commentary form (Settings → Commentary, and embedded in Review settings): the
 * OpenRouter model and API key that Game review's AI commentary uses.
 * Renders only the fields — no card chrome or heading — so the host decides the frame
 * (a card with a SectionHeader on Settings, a Disclosure in the review panel).
 *
 * The secret is sent directly over the preload IPC boundary to main, then cleared from
 * component state; it is never read back.
 */
export function OpenRouterSettingsCard() {
  const { config: openRouter, hasApiKey, saveState, save, clearKey } = useOpenRouterSave();
  const [model, setModel] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");

  useEffect(() => {
    if (openRouter.data?.model) setModel(openRouter.data.model);
  }, [openRouter.data?.model]);

  async function saveOpenRouter() {
    if (await save({ model, apiKey: apiKeyInput })) setApiKeyInput("");
  }

  async function clearOpenRouterKey() {
    if (await clearKey(model)) setApiKeyInput("");
  }

  const status =
    saveState.kind === "saved" && saveState.message
      ? saveState.message
      : hasApiKey
        ? "A key is saved."
        : "No key saved. Commentary needs one.";

  return (
    <div className="grid max-w-xl min-w-0 gap-3">
      <Field label="OpenRouter model" htmlFor="openrouter-model">
        <Input
          id="openrouter-model"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder={DEFAULT_COMMENTARY_MODEL}
          autoComplete="off"
        />
        {isLightweightCommentaryModel(model) ? (
          <p className={fieldHint}>
            Small, fast models tend to list facts instead of coaching. For clearer explanations try{" "}
            <button
              type="button"
              className="font-mono text-fg-muted underline underline-offset-2 hover:text-fg"
              onClick={() => setModel(DEFAULT_COMMENTARY_MODEL)}
            >
              {DEFAULT_COMMENTARY_MODEL}
            </button>
            .
          </p>
        ) : null}
      </Field>
      <Field label="OpenRouter API key" htmlFor="openrouter-key">
        <Input
          id="openrouter-key"
          type="password"
          value={apiKeyInput}
          onChange={(event) => setApiKeyInput(event.target.value)}
          placeholder={hasApiKey ? "Saved — leave blank to keep it" : "sk-or-…"}
          autoComplete="new-password"
          spellCheck={false}
        />
        <p className={fieldHint}>
          Create one at{" "}
          <a
            href={OPENROUTER_KEYS_URL}
            target="_blank"
            rel="noreferrer"
            className="text-fg-muted underline underline-offset-2 hover:text-fg"
          >
            openrouter.ai/keys
          </a>
          . Encrypted with your system keychain and sent only to OpenRouter. Never shown again.
        </p>
      </Field>
      {saveState.kind === "error" ? <Notice tone="danger">{saveState.message}</Notice> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => void saveOpenRouter()}
          disabled={saveState.kind === "saving" || !model.trim()}
        >
          {saveState.kind === "saving" ? "Saving…" : "Save"}
        </Button>
        {hasApiKey ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void clearOpenRouterKey()}
            disabled={saveState.kind === "saving"}
          >
            Remove saved key
          </Button>
        ) : null}
        <span
          key={saveState.kind === "saved" ? `saved-${status}` : "status"}
          className={cn(
            "flex min-w-0 items-center gap-1.5 text-xs",
            saveState.kind === "saved" ? "animate-rise-in text-accent" : "text-fg-subtle"
          )}
          role="status"
        >
          {saveState.kind === "saved" ? (
            <Check className="size-3.5 shrink-0" aria-hidden="true" />
          ) : null}
          <span className="truncate">{status}</span>
        </span>
      </div>
    </div>
  );
}
