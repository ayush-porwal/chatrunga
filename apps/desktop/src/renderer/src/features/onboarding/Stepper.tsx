import { focusRing } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { ONBOARDING_STEPS, onboardingStepLabels, type OnboardingStep } from "./onboarding-state";

/**
 * Where the user is in the five steps: a bar and a label each. The current bar fills; finished
 * bars are accent and can be clicked to go back.
 */
export function Stepper({
  step,
  onSelect
}: {
  step: OnboardingStep;
  onSelect: (step: OnboardingStep) => void;
}) {
  const current = ONBOARDING_STEPS.indexOf(step);
  return (
    <nav aria-label="Setup steps" data-slot="onb-stepper" className="px-[34px] pt-[30px]">
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
                  "group grid w-full min-w-0 gap-[9px] rounded-sm pb-0.5 text-left disabled:cursor-default",
                  focusRing
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "relative h-1 w-full overflow-hidden rounded-[3px] transition-colors duration-standard ease-standard",
                    done ? "bg-accent-strong group-hover:bg-accent" : "bg-line-strong"
                  )}
                >
                  {active ? <span className="onb-fill absolute inset-0 bg-fg" /> : null}
                </span>
                <span
                  className={cn(
                    "truncate text-[12px] transition-colors duration-standard",
                    active
                      ? "font-semibold text-fg"
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
