import { useEffect, useState } from "react";
import { useOpenRouterConfigQuery, useSettingsQuery, useUpdateSettingMutation } from "../../queries/api";
import { defaultSettings, type AppSettings } from "@chaturanga/shared/types/settings";
import { DEFAULT_COMMENTARY_MODEL, isLightweightCommentaryModel } from "@chaturanga/shared/llm/models";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { fieldHint } from "@/lib/ui";

/**
 * Shared BYOK commentary form (Settings → Commentary, and embedded in Review settings).
 * Renders only the fields — no card chrome or heading — so the host decides the frame
 * (a card with a SectionHeader on Settings, a Disclosure in the review panel).
 *
 * The secret is sent directly over the preload IPC boundary to main, then cleared from
 * component state; it is never read back.
 */
export function OpenRouterSettingsCard() {
  const openRouter = useOpenRouterConfigQuery();
  const settingsQuery = useSettingsQuery();
  const updateSetting = useUpdateSettingMutation();
  const settings: AppSettings = { ...defaultSettings, ...(settingsQuery.data ?? {}) };
  const [model, setModel] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [saveState, setSaveState] = useState<{ kind: "idle" | "saving" | "saved" | "error"; message?: string }>({ kind: "idle" });
  const hasApiKey = Boolean(openRouter.data?.hasApiKey);

  useEffect(() => {
    if (openRouter.data?.model) setModel(openRouter.data.model);
  }, [openRouter.data?.model]);

  async function saveOpenRouter() {
    if (!window.chaturanga) {
      setSaveState({ kind: "error", message: "OpenRouter settings are available in the desktop app." });
      return;
    }
    setSaveState({ kind: "saving" });
    try {
      await window.chaturanga.commentary.setOpenRouterConfig({
        model,
        ...(apiKeyInput.trim() ? { apiKey: apiKeyInput.trim() } : {})
      });
      setApiKeyInput("");
      setSaveState({ kind: "saved", message: "Saved." });
      await openRouter.refetch();
    } catch (error) {
      setSaveState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not save OpenRouter settings."
      });
    }
  }

  async function clearOpenRouterKey() {
    if (!window.chaturanga) return;
    setSaveState({ kind: "saving" });
    try {
      await window.chaturanga.commentary.setOpenRouterConfig({ apiKey: null, model });
      setApiKeyInput("");
      setSaveState({ kind: "saved", message: "Key removed. Local commentary is used." });
      await openRouter.refetch();
    } catch (error) {
      setSaveState({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not remove the saved key."
      });
    }
  }

  const status =
    saveState.kind === "saved" && saveState.message
      ? saveState.message
      : hasApiKey
        ? "A key is saved."
        : "No key saved — local commentary is used.";

  return (
    <div className="grid max-w-xl min-w-0 gap-3">
      <Field label="Source" htmlFor="review-provider">
        <Select
          id="review-provider"
          value={settings.reviewCommentaryProvider}
          onChange={(event) =>
            updateSetting.mutate({
              key: "reviewCommentaryProvider",
              value: event.target.value as AppSettings["reviewCommentaryProvider"]
            })
          }
        >
          <option value="openrouter">OpenRouter · your key</option>
          <option value="local">Local (offline)</option>
        </Select>
      </Field>
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
        <p className={fieldHint}>Encrypted with your system keychain and sent only to OpenRouter. Never shown again.</p>
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
          <Button type="button" variant="ghost" size="sm" onClick={() => void clearOpenRouterKey()} disabled={saveState.kind === "saving"}>
            Remove saved key
          </Button>
        ) : null}
        <span className="text-xs text-fg-subtle" role="status">
          {status}
        </span>
      </div>
    </div>
  );
}
