import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import {
  DEFAULT_BOOK_OCR_MODEL,
  DEFAULT_COMMENTARY_MODEL,
  isLightweightCommentaryModel
} from "@chaturanga/shared/llm/models";
import type { OpenRouterConfigSummary } from "@chaturanga/shared/ipc/chaturanga-api";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { fieldHint } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { OPENROUTER_KEYS_URL, useOpenRouterSave } from "./use-openrouter-save";

/** A model field's text, set to the saved model whenever that arrives or changes. */
function useStoredModel(
  config: OpenRouterConfigSummary | undefined,
  field: "model" | "bookOcrModel"
) {
  const saved = config?.[field];
  const [text, setText] = useState("");
  useEffect(() => {
    if (saved) setText(saved);
  }, [saved]);
  return [text, setText] as const;
}

/**
 * The BYOK AI form (Settings → AI): the OpenRouter model and API key every AI feature uses
 * (Game review's commentary, puzzle explanations, turning a book's pages into lines), and the
 * model that reads a book's page images. Renders only the fields — no card chrome or heading — so
 * the host decides the frame.
 *
 * The secret is sent directly over the preload IPC boundary to main, then cleared from
 * component state; it is never read back.
 */
export function OpenRouterSettingsCard() {
  const { config: openRouter, hasApiKey, saveState, save, clearKey } = useOpenRouterSave();
  const [model, setModel] = useStoredModel(openRouter.data, "model");
  const [bookOcrModel, setBookOcrModel] = useStoredModel(openRouter.data, "bookOcrModel");
  const [apiKeyInput, setApiKeyInput] = useState("");

  async function saveOpenRouter() {
    if (await save({ model, bookOcrModel, apiKey: apiKeyInput })) setApiKeyInput("");
  }

  async function clearOpenRouterKey() {
    if (await clearKey(model)) setApiKeyInput("");
  }

  const status =
    saveState.kind === "saved" && saveState.message
      ? saveState.message
      : hasApiKey
        ? "A key is saved."
        : "No key saved. AI features need one.";

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
        {model.trim() !== DEFAULT_COMMENTARY_MODEL && isLightweightCommentaryModel(model) ? (
          <p className={fieldHint}>Small, fast models tend to list facts instead of coaching.</p>
        ) : null}
      </Field>
      <Field label="Book OCR model" htmlFor="openrouter-book-ocr-model">
        <Input
          id="openrouter-book-ocr-model"
          value={bookOcrModel}
          onChange={(event) => setBookOcrModel(event.target.value)}
          placeholder={DEFAULT_BOOK_OCR_MODEL}
          autoComplete="off"
        />
        <p className={fieldHint}>Reads the page images of a book you import. Needs vision.</p>
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
