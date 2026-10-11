import {
  Check,
  CircleAlert,
  Download,
  Minus,
  RotateCcw,
  Swords,
  type LucideIcon
} from "lucide-react";
import type { AppSettings } from "@chaturanga/shared/types/settings";
import { headlineRating } from "@chaturanga/shared/types/ratings";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useOpenRouterConfigQuery } from "../../queries/api";
import { engineSummary, levelSummary, type EngineSummary } from "./onboarding-state";
import { ProgressRing } from "./ProgressRing";
import { StepIconButton, StepRow, StepRows } from "./step-parts";
import { PrimaryButton, StepFooter, StepHeader, type StepHeadingProps } from "./StepChrome";
import type { EngineSetup } from "./useEngineSetup";

type SummaryTone = EngineSummary["tone"];

const toneIcon: Record<SummaryTone, { className: string; Icon: LucideIcon }> = {
  done: { className: "bg-[rgb(143_182_111/0.16)] text-accent", Icon: Check },
  busy: { className: "bg-[rgb(143_182_111/0.14)] text-accent", Icon: Download },
  failed: { className: "bg-[rgb(255_154_141/0.14)] text-danger", Icon: CircleAlert },
  skipped: { className: "bg-control text-fg-subtle", Icon: Minus }
};

/**
 * The row's status glyph in a small round tile. A check pops in, one row after another
 * (`onb-pop`, staggered by `order`); a download in progress keeps a still glyph and lets its ring
 * move.
 */
function SummaryIcon({ tone, order }: { tone: SummaryTone; order: number }) {
  const { className, Icon } = toneIcon[tone];
  const done = tone === "done";
  return (
    <span
      aria-hidden
      className={cn("grid size-[22px] shrink-0 place-items-center rounded-full", className)}
    >
      <Icon
        strokeWidth={2.6}
        className={cn("size-[13px]", done && "onb-pop")}
        style={done ? { animationDelay: `${200 + order * 120}ms` } : undefined}
      />
    </span>
  );
}

/** The last step: what was set up (with a way to fix what wasn't), and one way into the app. */
export function DoneStep({
  setup,
  settings,
  onBack,
  onDone,
  footer,
  ...heading
}: StepHeadingProps & {
  setup: EngineSetup;
  settings: AppSettings;
  /** Back to the AI coach step (also "Add key"). */
  onBack: () => void;
  onDone: () => void;
}) {
  const coach = useOpenRouterConfigQuery();
  const hasKey = Boolean(coach.data?.hasApiKey);
  const engines = engineSummary(setup);

  return (
    <>
      <StepHeader {...heading} title="You’re all set" />

      <StepRows label="Setup summary">
        <StepRow
          lead={<SummaryIcon tone={engines.tone} order={0} />}
          title="Engines"
          detail={<span role="status">{engines.text}</span>}
          end={<EngineAction summary={engines} setup={setup} />}
        />
        <StepRow
          lead={<SummaryIcon tone="done" order={1} />}
          title="Your level"
          detail={levelSummary(headlineRating(settings.playerRatings), settings.reviewPlayerColor)}
        />
        <StepRow
          lead={<SummaryIcon tone={hasKey ? "done" : "skipped"} order={2} />}
          title="AI coach"
          detail={hasKey ? "Key saved" : "Skipped"}
          end={
            hasKey ? null : (
              <Button
                variant="ghost"
                size="xs"
                className="h-[26px] rounded-[7px] px-[9px] text-[12.5px]"
                onClick={onBack}
              >
                Add key
              </Button>
            )
          }
        />
      </StepRows>

      <StepFooter
        footer={footer}
        back={onBack}
        primary={
          <PrimaryButton onClick={onDone}>
            <Swords />
            Start playing
          </PrimaryButton>
        }
      />
    </>
  );
}

/** What the Engines row offers: its progress ring, Retry, Try again, or Download. */
function EngineAction({ summary, setup }: { summary: EngineSummary; setup: EngineSetup }) {
  if (summary.tone === "busy") {
    return <ProgressRing value={summary.percent} label="Engine downloads" />;
  }
  if (summary.tone === "failed") {
    return "retry" in summary ? (
      <StepIconButton
        label="Retry the download"
        tooltip="Retry"
        icon={<RotateCcw />}
        onClick={() => setup.retry(summary.retry)}
      />
    ) : (
      <StepIconButton
        label="Check the engines again"
        tooltip="Try again"
        icon={<RotateCcw />}
        onClick={setup.recheck}
      />
    );
  }
  if (summary.tone === "skipped" && summary.download) {
    return (
      <Button
        variant="ghost"
        size="xs"
        className="h-[26px] rounded-[7px] px-[9px] text-[12.5px]"
        onClick={setup.start}
      >
        Download
      </Button>
    );
  }
  return null;
}
