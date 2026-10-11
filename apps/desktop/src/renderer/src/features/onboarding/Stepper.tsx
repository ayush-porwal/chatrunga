import { focusRing } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { ONBOARDING_STEPS, onboardingStepLabels, type OnboardingStep } from "./onboarding-state";

/** Where the user is in the five steps; finished steps can be revisited. */
export function Stepper({
  step,
  onSelect
}: {
  step: OnboardingStep;
  onSelect: (step: OnboardingStep) => void;
}) {
  const current = ONBOARDING_STEPS.indexOf(step);
  return (
    <nav aria-label="Setup steps" data-slot="onb-stepper">
      <ol className="grid grid-cols-5 gap-2">
        {ONBOARDING_STEPS.map((item, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <li key={item} className="min-w-0">
              <button
                type="button"
                disabled={!done}
                aria-current={active ? "step" : undefined}
                onClick={() => onSelect(item)}
                className={cn(
                  "group grid w-full min-w-0 gap-2 rounded-sm pb-0.5 text-left disabled:cursor-default",
                  focusRing
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "h-0.5 w-full rounded-full transition-colors duration-standard ease-standard",
                    done
                      ? "bg-accent/70 group-hover:bg-accent"
                      : active
                        ? "bg-fg"
                        : "bg-line-strong"
                  )}
                />
                <span
                  className={cn(
                    "truncate text-xs transition-colors duration-standard",
                    active
                      ? "text-fg"
                      : done
                        ? "text-fg-muted group-hover:text-fg-secondary"
                        : "text-fg-subtle"
                  )}
                >
                  {onboardingStepLabels[item]}
                  {done ? <span className="sr-only"> (done)</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
