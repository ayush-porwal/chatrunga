import { useState } from "react";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { isElectronMac } from "@/lib/environment";
import { fieldHint, fieldLabel, focusRing } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { OPENROUTER_KEYS_URL, useOpenRouterSave } from "../settings/use-openrouter-save";
import { PrimaryButton, StepFooter, StepHeader, type StepHeadingProps } from "./StepChrome";

export function CoachStep({
  onBack,
  onNext,
  footer,
  ...heading
}: StepHeadingProps & { onBack: () => void; onNext: () => void }) {
  const { hasApiKey, saveState, save, config } = useOpenRouterSave();
  const [key, setKey] = useState("");
  const [replacing, setReplacing] = useState(false);
  const showField = !hasApiKey || replacing;

  const saveAndContinue = async () => {
    if (!key.trim()) {
      onNext();
      return;
    }
    if (await save({ apiKey: key })) {
      setKey("");
      setReplacing(false);
      onNext();
    }
  };

  return (
    <>
      <StepHeader {...heading} title="Add the AI coach">
        <p>
          The coach writes the explanations in Game review. It uses an AI model through OpenRouter
          with your own key, so you choose the model and pay OpenRouter for what you use.
        </p>
      </StepHeader>

      <dl className="grid gap-px overflow-hidden rounded-xl border border-line bg-line-subtle text-sm">
        <div className="grid gap-0.5 bg-surface px-4 py-3">
          <dt className="font-medium text-fg-secondary">What is sent</dt>
          <dd className="leading-5 text-fg-muted">
            The position, the moves and the engine’s findings for the move you are reading. Nothing
            else from this computer.
          </dd>
        </div>
        <div className="grid gap-0.5 bg-surface px-4 py-3">
          <dt className="font-medium text-fg-secondary">Where your key is kept</dt>
          <dd className="leading-5 text-fg-muted">
            Encrypted on this computer, and only read to send a request.
            {isElectronMac() ? " Your Mac may ask once to allow keychain access." : null}
          </dd>
        </div>
      </dl>

      {config.isPending ? (
        <Skeleton className="h-9 w-full rounded-lg" />
      ) : showField ? (
        <div className="grid gap-2">
          <div className="flex h-5 items-center justify-between gap-2">
            <label htmlFor="onboarding-openrouter-key" className={fieldLabel}>
              OpenRouter API key
            </label>
            <a
              href={OPENROUTER_KEYS_URL}
              target="_blank"
              rel="noreferrer"
              className={cn(
                "inline-flex items-center gap-1 rounded-sm text-xs leading-5 text-fg-muted underline-offset-4 hover:text-fg hover:underline",
                focusRing
              )}
            >
              Get a key
              <ExternalLink className="size-3" aria-hidden />
              <span className="sr-only">(opens openrouter.ai in your browser)</span>
            </a>
          </div>
          <Input
            id="onboarding-openrouter-key"
            type="password"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && key.trim()) void saveAndContinue();
            }}
            placeholder="sk-or-…"
            autoComplete="new-password"
            spellCheck={false}
          />
          <p className={fieldHint}>
            Optional. Until you add one, reviews show the engine’s findings only.
          </p>
        </div>
      ) : (
        <p className="flex h-9 items-center gap-2 text-sm text-accent" role="status">
          <CheckCircle2 className="size-4" aria-hidden />A key is saved.
          <Button variant="link" size="sm" className="ml-1" onClick={() => setReplacing(true)}>
            Replace it
          </Button>
        </p>
      )}
      {saveState.kind === "error" ? <Notice tone="danger">{saveState.message}</Notice> : null}

      <StepFooter
        footer={footer}
        back={onBack}
        secondary={
          showField ? (
            <Button variant="ghost" className="h-10" onClick={onNext}>
              Skip for now
            </Button>
          ) : null
        }
        primary={
          showField ? (
            <PrimaryButton
              disabled={!key.trim() || saveState.kind === "saving"}
              onClick={() => void saveAndContinue()}
            >
              {saveState.kind === "saving" ? "Saving…" : "Save and continue"}
            </PrimaryButton>
          ) : (
            <PrimaryButton onClick={onNext}>Continue</PrimaryButton>
          )
        }
      />
    </>
  );
}
