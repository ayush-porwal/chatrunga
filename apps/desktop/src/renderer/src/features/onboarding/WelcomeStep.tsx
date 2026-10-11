import { PrimaryButton, StepFooter, StepHeader, type StepHeadingProps } from "./StepChrome";

export function WelcomeStep({
  onNext,
  footer,
  ...heading
}: StepHeadingProps & { onNext: () => void }) {
  return (
    <>
      <StepHeader {...heading} title="Welcome to Chaturanga">
        <p className="text-base leading-7 text-fg-secondary">
          Review your chess games move by move. An engine finds the moments that mattered, and a
          coach explains them in plain words.
        </p>
        <p>
          Your games and engines stay on this computer. Setup takes about a minute, and you can skip
          any part of it.
        </p>
      </StepHeader>
      <StepFooter
        footer={footer}
        primary={<PrimaryButton onClick={onNext}>Continue</PrimaryButton>}
      />
    </>
  );
}
