import { useState } from "react";
import {
  ArrowRight,
  Check,
  CircleAlert,
  ExternalLink,
  KeyRound,
  Loader2,
  Shield
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { focusRing } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { OPENROUTER_KEYS_URL, useOpenRouterSave } from "../settings/use-openrouter-save";
import { StepBand, stepFieldLabel } from "./step-parts";
import {
  PrimaryButton,
  SecondaryButton,
  StepFooter,
  StepHeader,
  type StepHeadingProps
} from "./StepChrome";

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
  const saving = saveState.kind === "saving";

  const saveAndContinue = async () => {
    if (await save({ apiKey: key })) {
      setKey("");
      setReplacing(false);
      onNext();
    }
  };

  return (
    <>
      <StepHeader {...heading} title="AI coach">
        <p>Explains moves in plain words. Optional.</p>
      </StepHeader>

      {saveState.kind === "error" ? (
        <StepBand tone="danger" icon={<CircleAlert />}>
          {saveState.message}
        </StepBand>
      ) : null}

      {config.isPending ? (
        <Skeleton className="h-[50px] w-full rounded-[10px]" />
      ) : showField ? (
        <div className="grid gap-[8px]">
          <div className="flex items-baseline gap-[8px]">
            <label htmlFor="onboarding-openrouter-key" className={stepFieldLabel}>
              OpenRouter key
            </label>
            <a
              href={OPENROUTER_KEYS_URL}
              target="_blank"
              rel="noreferrer"
              className={cn(
                "ml-auto inline-flex items-center gap-[4px] rounded-sm text-[12.5px] text-accent-fg underline-offset-4 hover:underline",
                focusRing
              )}
            >
              Get a key
              <ExternalLink className="size-[12px]" aria-hidden />
              <span className="sr-only">(opens openrouter.ai in your browser)</span>
            </a>
          </div>
          <div className="flex h-[50px] items-center gap-[8px] rounded-[10px] border border-line-strong bg-surface-sunken px-[12px] text-fg-subtle transition-[border-color,box-shadow] duration-[180ms] focus-within:border-accent-strong focus-within:text-fg focus-within:shadow-[0_0_0_3px_rgb(143_182_111/0.15)]">
            <KeyRound className="size-[16px] shrink-0 text-fg-subtle" aria-hidden />
            <input
              id="onboarding-openrouter-key"
              type="password"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && key.trim() && !saving) void saveAndContinue();
              }}
              placeholder="sk-or-…"
              autoComplete="new-password"
              spellCheck={false}
              className="h-full min-w-0 flex-1 bg-transparent font-mono text-[15px] text-fg outline-none placeholder:text-fg-subtle"
            />
          </div>
        </div>
      ) : (
        <StepBand
          tone="success"
          icon={<Check className="onb-pop" />}
          action={
            <Button
              variant="ghost"
              size="xs"
              className="h-[26px] rounded-[7px] px-[9px] text-[12.5px]"
              onClick={() => setReplacing(true)}
            >
              Replace it
            </Button>
          }
        >
          A key is saved.
        </StepBand>
      )}

      <p className="flex items-start gap-[8px] text-[12.5px] leading-[1.45] text-fg-subtle">
        <Shield className="mt-[2px] size-[14px] shrink-0" aria-hidden />
        Only the game you’re reviewing is sent: its moves and details, your rating and the engine’s
        findings. Your key stays encrypted here.
      </p>

      <StepFooter
        footer={footer}
        back={onBack}
        secondary={showField ? <SecondaryButton onClick={onNext}>Skip</SecondaryButton> : null}
        primary={
          showField ? (
            <PrimaryButton disabled={!key.trim() || saving} onClick={() => void saveAndContinue()}>
              {saving ? (
                <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden />
              ) : (
                <Check />
              )}
              {saving ? "Saving…" : "Save"}
            </PrimaryButton>
          ) : (
            <PrimaryButton onClick={onNext}>
              <ArrowRight />
              Continue
            </PrimaryButton>
          )
        }
      />
    </>
  );
}
