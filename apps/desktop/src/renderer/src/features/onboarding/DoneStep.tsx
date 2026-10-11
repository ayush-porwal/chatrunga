import type { ReactNode } from "react";
import { CheckCircle2, CircleAlert, Loader2, Minus } from "lucide-react";
import type { AppSettings } from "@chaturanga/shared/types/settings";
import { headlineRating } from "@chaturanga/shared/types/ratings";
import { Progress } from "@/components/ui/progress";
import { useOpenRouterConfigQuery } from "../../queries/api";
import { nearestLevelPreset } from "./onboarding-state";
import { PrimaryButton, StepFooter, StepHeader, type StepHeadingProps } from "./StepChrome";
import type { EngineSetup } from "./useEngineSetup";

type SummaryTone = "done" | "busy" | "skipped" | "failed";

function SummaryRow({
  tone,
  title,
  children,
  extra
}: {
  tone: SummaryTone;
  title: string;
  children: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 gap-y-2 bg-surface px-4 py-3.5">
      <span className="grid h-5 place-items-center" aria-hidden>
        {tone === "done" ? (
          <CheckCircle2 className="size-4 text-accent" />
        ) : tone === "busy" ? (
          <Loader2 className="size-4 animate-spin text-fg-muted motion-reduce:animate-none" />
        ) : tone === "failed" ? (
          <CircleAlert className="size-4 text-danger" />
        ) : (
          <Minus className="size-4 text-fg-subtle" />
        )}
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className="text-sm font-medium leading-5 text-fg-secondary">{title}</span>
        <span className="text-xs leading-5 text-fg-muted">{children}</span>
      </span>
      {extra ? <span className="col-start-2">{extra}</span> : null}
    </li>
  );
}

/** The summary's Engines line: downloading, ready, failed, still checking, or skipped. */
function engineSummary(
  setup: EngineSetup,
  ownEngine: boolean
): { tone: SummaryTone; text: string } {
  if (setup.phase === "downloading") {
    return {
      tone: "busy",
      text:
        setup.stockfishPercent !== null
          ? `Downloading Stockfish (${setup.stockfishPercent}%). It carries on in the background, and Play shows the progress.`
          : setup.engineReady
            ? "Stockfish is ready. Maia is still downloading in the background; Play shows the progress."
            : "Installing Stockfish. Play shows the progress."
    };
  }
  if (setup.engineReady) {
    const allInstalled = setup.rows.length > 0 && setup.rows.every((row) => row.status === "ready");
    return {
      tone: "done",
      text: allInstalled ? "Stockfish and Maia are ready." : "An engine is ready for Game review."
    };
  }
  const failed = setup.rows.find((row) => row.status === "error");
  if (failed) {
    return { tone: "failed", text: `${failed.label} didn’t download. You can retry it from Play.` };
  }
  if (setup.phase === "checking") return { tone: "busy", text: "Checking…" };
  return {
    tone: "skipped",
    text: ownEngine
      ? "Add your own engine in Settings, Engines."
      : "Skipped. Play offers the download whenever you want it."
  };
}

/** The summary's level line: the rating (named when it is a preset) and the side reviewed. */
function levelSummary(settings: AppSettings): string {
  const yourRating = headlineRating(settings.playerRatings);
  const preset = nearestLevelPreset(yourRating);
  const side = settings.reviewPlayerColor === "black" ? "Black" : "White";
  return preset.rating === yourRating
    ? `${preset.rating}, ${preset.label.toLowerCase()}. Explanations are written for ${side}.`
    : `${yourRating}. Explanations are written for ${side}.`;
}

/** The last step: what was set up, and one way into the app. */
export function DoneStep({
  setup,
  ownEngine,
  settings,
  onBack,
  onDone,
  footer,
  ...heading
}: StepHeadingProps & {
  setup: EngineSetup;
  ownEngine: boolean;
  settings: AppSettings;
  onBack: () => void;
  onDone: () => void;
}) {
  const coach = useOpenRouterConfigQuery();
  const hasKey = Boolean(coach.data?.hasApiKey);
  const engines = engineSummary(setup, ownEngine);

  return (
    <>
      <StepHeader {...heading} title="You’re all set">
        <p>Here’s what is set up. You can change any of it later in Settings.</p>
      </StepHeader>

      <ul
        aria-label="Setup summary"
        className="grid gap-px overflow-hidden rounded-xl border border-line bg-line-subtle"
      >
        <SummaryRow
          tone={engines.tone}
          title="Engines"
          extra={
            setup.phase === "downloading" && setup.stockfishPercent !== null ? (
              <Progress value={setup.stockfishPercent} aria-label="Stockfish download" />
            ) : null
          }
        >
          <span role="status">{engines.text}</span>
        </SummaryRow>
        <SummaryRow tone="done" title="Your level">
          {levelSummary(settings)}
        </SummaryRow>
        <SummaryRow tone={hasKey ? "done" : "skipped"} title="AI coach">
          {hasKey
            ? "Your OpenRouter key is saved. Reviews come with explanations."
            : "Skipped. Reviews show the engine’s findings; add a key in Settings, AI."}
        </SummaryRow>
      </ul>

      <StepFooter
        footer={footer}
        back={onBack}
        primary={<PrimaryButton onClick={onDone}>Start using Chaturanga</PrimaryButton>}
      />
    </>
  );
}
