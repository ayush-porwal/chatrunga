import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { defaultSettings, type AppSettings } from "@chaturanga/shared/types/settings";
import { Button } from "@/components/ui/button";
import { useExitGhost } from "@/components/ui/use-presence";
import { motion } from "@/lib/ui";
import { useSettingsQuery } from "../../queries/api";
import { useSetSetting } from "../settings/use-set-setting";
import { CoachStep } from "./CoachStep";
import { DoneStep } from "./DoneStep";
import { EnginesStep } from "./EnginesStep";
import { LevelStep } from "./LevelStep";
import { ONBOARDING_STEPS, type OnboardingStep } from "./onboarding-state";
import { Stage } from "./Stage";
import { Stepper } from "./Stepper";
import { useEngineSetup } from "./useEngineSetup";
import { WelcomeStep } from "./WelcomeStep";

/**
 * The first-run welcome: a full-window, five-step setup that ends in the app.
 *
 *   Welcome → Engines → Your level → AI coach → All set
 *
 * Layout: one fixed design frame (`.onb-frame` in app.css, 960×592 at scale 1) zoomed to fit the
 * window, so the board, type and spacing grow together on big windows and every edge stays where
 * it is from step to step. Left column: a board following Morphy's Opera game (illustration only),
 * the game's caption, and a coach note on the move shown; the note card's bottom edge is the
 * frame's bottom edge. Right column: the stepper (its top is the board's top), the step's content
 * (scrolls inside when long) and the footer — Back on the left, the primary action in a
 * fixed-width slot on the right, a secondary action just left of it — at the same place on every
 * step. Everything is optional: "Skip setup" (or Escape) leaves at any point, and engine downloads
 * keep running in the background whatever the user does next.
 *
 * Keyboard: focus moves to each step's heading (announced by screen readers), Tab stays inside the
 * welcome, Escape skips. Reduced motion: step, board and note changes are instant.
 */
export function OnboardingFlow({
  onFinish,
  onGoPlay
}: {
  /** Marks the welcome done (stored) and closes it. */
  onFinish: () => void;
  /** Shows Play (the last step's "Start using Chaturanga"). */
  onGoPlay: () => void;
}) {
  const [step, setStep] = useState<OnboardingStep>("welcome");
  // +1 moving forward, -1 back: the step content slides in from that side.
  const [direction, setDirection] = useState<1 | -1>(1);
  const [ownEngine, setOwnEngine] = useState(false);
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

  const go = (next: OnboardingStep) => {
    setDirection(ONBOARDING_STEPS.indexOf(next) < ONBOARDING_STEPS.indexOf(step) ? -1 : 1);
    setStep(next);
  };
  const finishWith = (action?: () => void) => {
    onFinish();
    action?.();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The app's own shortcuts (move stepping, focus mode) must not act under the welcome.
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      finishWith();
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
      className="onb-root fixed inset-0 z-50 grid animate-fade-in grid-rows-[var(--titlebar-height)_minmax(0,1fr)_var(--titlebar-height)] bg-canvas text-fg [--titlebar-height:calc(54px/var(--window-zoom,1))] data-[state=closed]:animate-fade-out"
    >
      {/* Titlebar row: drags the window (the traffic lights sit on the left on macOS). "Skip setup"
          lines up with the frame's right edge, not the window corner. */}
      <div className="flex justify-center [-webkit-app-region:drag]">
        <div className="onb-bar flex items-center justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="-mr-2.5 [-webkit-app-region:no-drag]"
            onClick={() => finishWith()}
          >
            {step === "done" ? "Close" : "Skip setup"}
          </Button>
        </div>
      </div>

      {/* The frame, centred in the whole window (a titlebar-high row balances it underneath). The
          empty space around it drags the window too. */}
      <div className="grid min-h-0 place-items-center overflow-hidden [-webkit-app-region:drag]">
        <div className="onb-frame grid grid-cols-[424px_464px] gap-x-[72px] [-webkit-app-region:no-drag]">
          <Stage step={step} />

          <div className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto]">
            <Stepper step={step} onSelect={go} />
            <div
              key={step}
              className="onb-step-in scroll-area scroll-fade -mx-1 mt-10 min-h-0 overflow-y-auto px-1 pb-1"
              style={{ "--onb-dir": direction }}
            >
              <div className="grid content-start gap-6">
                {step === "welcome" ? (
                  <WelcomeStep {...heading} onNext={() => go("engines")} />
                ) : step === "engines" ? (
                  <EnginesStep
                    {...heading}
                    setup={setup}
                    onBack={() => go("welcome")}
                    onNext={() => go("level")}
                    onOwnEngine={() => {
                      setOwnEngine(true);
                      go("level");
                    }}
                  />
                ) : step === "level" ? (
                  <LevelStep
                    {...heading}
                    settings={settings}
                    setSetting={setSetting}
                    onBack={() => go("engines")}
                    onNext={() => go("coach")}
                  />
                ) : step === "coach" ? (
                  <CoachStep {...heading} onBack={() => go("level")} onNext={() => go("done")} />
                ) : (
                  <DoneStep
                    {...heading}
                    setup={setup}
                    ownEngine={ownEngine}
                    settings={settings}
                    onBack={() => go("coach")}
                    onDone={() => finishWith(onGoPlay)}
                  />
                )}
              </div>
            </div>
            {/* The footer row: every step renders its buttons into it (StepFooter), so it never
                moves between steps and never animates with the content. */}
            <div
              ref={setFooter}
              data-slot="onb-footer"
              className="mt-5 border-t border-line-subtle pt-5"
            />
          </div>
        </div>
      </div>
      <div aria-hidden className="[-webkit-app-region:drag]" />
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
