import { ArrowRight } from "lucide-react";
import { PieceArt, useBoardSquareColors } from "../play/piece-art";
import {
  PrimaryButton,
  SecondaryButton,
  StepFooter,
  StepHeader,
  type StepHeadingProps
} from "./StepChrome";

export function WelcomeStep({
  onNext,
  onSkip,
  footer,
  ...heading
}: StepHeadingProps & { onNext: () => void; onSkip: () => void }) {
  const { dark } = useBoardSquareColors();
  return (
    <>
      {/* The user's knight on their board's dark square, floating gently. */}
      <span
        aria-hidden
        className="onb-float grid size-[84px] place-items-center rounded-[22px] shadow-[0_12px_30px_-12px_#000]"
        style={{ backgroundColor: dark }}
      >
        <PieceArt color="white" piece="knight" className="size-[66px]" />
      </span>
      <StepHeader {...heading} title="Welcome to Chaturanga">
        <p>Play, review and train. Everything stays on this computer.</p>
      </StepHeader>
      <StepFooter
        footer={footer}
        secondary={<SecondaryButton onClick={onSkip}>Skip setup</SecondaryButton>}
        primary={
          <PrimaryButton onClick={onNext}>
            <ArrowRight />
            Get started
          </PrimaryButton>
        }
      />
    </>
  );
}
