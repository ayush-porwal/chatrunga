import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { defaultSettings, type AppSettings } from "@chaturanga/shared/types/settings";
import { useExitGhost } from "@/components/ui/use-presence";
import { motion } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useSettingsQuery } from "../../queries/api";
import { useSetSetting } from "../settings/use-set-setting";
import { CoachStep } from "./CoachStep";
import { DoneStep } from "./DoneStep";
import { EnginesStep } from "./EnginesStep";
import { LevelStep } from "./LevelStep";
import type { OnboardingStep } from "./onboarding-state";
import { Stage } from "./Stage";
import { Stepper } from "./Stepper";
import { useEngineSetup } from "./useEngineSetup";
import { WelcomeStep } from "./WelcomeStep";

/**
 * The first-run welcome: a full-window, five-step setup that ends on Play.
 *
 *   Welcome → Engines → Your level → AI coach → All set
 *
 * Layout: one fixed design frame (`.onb-frame` in app.css, 1440×900 at scale 1) zoomed to fit the
 * window, so the board, type and spacing grow together and every edge stays where it is from step
 * to step. There is no title bar row: the frame's empty top strip drags the window, and the macOS
 * traffic lights float over it (Windows and Linux keep their native frame). Left: the board,
 * 808×808, looping Morphy's finish from the Opera game; it never restarts per step. Right: the card,
 * as tall as the board — the stepper, the step's content (it rises in, and scrolls inside when
 * long) and the footer, three equal slots `[Back] [secondary] [primary]` at the same place on
 * every step. Everything is optional: Skip setup (Welcome), Escape and Start playing all finish
 * the welcome and land on Play, and engine downloads keep running in the background.
 *
 * Keyboard: focus moves to each step's heading (announced by screen readers), Tab stays inside the
 * welcome, Escape skips. Reduced motion: no rise, glow or loop (the board shows the final mate).
 */
export function OnboardingFlow({
  onFinish,
  onGoPlay
}: {
  /** Marks the welcome done (stored) and closes it. */
  onFinish: () => void;
  /** Shows Play: every way out of the welcome lands there. */
  onGoPlay: () => void;
}) {
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const headingId = useId();
  const setup = useEngineSetup();
  const settingsQuery = useSettingsQuery();
  const settings: AppSettings = { ...defaultSettings, ...settingsQuery.data };
  const setSetting = useSetSetting();

  useExitGhost(rootRef, motion.ms.standard);

  // Each step's heading takes focus, so screen readers announce the step and Tab starts from it.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  const exit = () => {
    onFinish();
    onGoPlay();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The app's own shortcuts (move stepping, focus mode) must not act under the welcome.
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      exit();
      return;
    }
    if (event.key === "Tab") trapTab(event, rootRef.current);
  };

  const heading = { headingRef, headingId, footer };

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the modal dialog handles Escape, keeps Tab inside and stops the app's shortcuts
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      data-state="open"
      onKeyDown={onKeyDown}
      className="onb-root fixed inset-0 z-50 grid animate-fade-in place-items-center overflow-hidden bg-canvas text-fg [-webkit-app-region:drag] data-[state=closed]:animate-fade-out"
    >
      <span aria-hidden className="onb-glow" />
      <span aria-hidden className="onb-glow onb-glow-b" />
      {/* The frame's padding is empty and drags the window (the top strip is where the traffic
          lights float); the board and the card don't. */}
      <div className="onb-frame relative grid grid-cols-[808px_minmax(0,1fr)] items-center gap-[40px] pb-[44px] pl-[48px] pr-[44px] pt-[48px]">
        <div className="[-webkit-app-region:no-drag]">
          <Stage />
        </div>

        <div className="flex h-[808px] min-w-0 flex-col overflow-hidden rounded-[20px] border border-line bg-surface shadow-[0_30px_70px_-40px_#000] [-webkit-app-region:no-drag]">
          <Stepper step={step} onSelect={setStep} />
          {/* Remounts per step, so its direct children rise in again (`.onb-body` in app.css). */}
          <div
            key={step}
            className={cn(
              "onb-body scroll-area scroll-fade grid min-h-0 flex-1 gap-[26px] overflow-y-auto px-[34px] pt-[52px]",
              step === "welcome" ? "content-center pb-[60px]" : "content-start pb-[18px]"
            )}
          >
            {step === "welcome" ? (
              <WelcomeStep {...heading} onNext={() => setStep("engines")} onSkip={exit} />
            ) : step === "engines" ? (
              <EnginesStep
                {...heading}
                setup={setup}
                onBack={() => setStep("welcome")}
                onNext={() => setStep("level")}
              />
            ) : step === "level" ? (
              <LevelStep
                {...heading}
                settings={settings}
                setSetting={setSetting}
                onBack={() => setStep("engines")}
                onNext={() => setStep("coach")}
              />
            ) : step === "coach" ? (
              <CoachStep
                {...heading}
                onBack={() => setStep("level")}
                onNext={() => setStep("done")}
              />
            ) : (
              <DoneStep
                {...heading}
                setup={setup}
                settings={settings}
                onBack={() => setStep("coach")}
                onDone={exit}
              />
            )}
          </div>
          {/* The footer row: every step renders its buttons into it (StepFooter), so it never
              moves between steps and never animates with the content. */}
          <div
            ref={setFooter}
            data-slot="onb-footer"
            className="border-t border-line-subtle px-[24px] pb-[24px] pt-[18px]"
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ focus */

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab inside the welcome. */
function trapTab(event: KeyboardEvent<HTMLElement>, root: HTMLElement | null) {
  if (!root) return;
  const focusable = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.offsetParent !== null
  );
  const first = focusable.at(0);
  const last = focusable.at(-1);
  if (!first || !last) return;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !root.contains(active) || active === root)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
