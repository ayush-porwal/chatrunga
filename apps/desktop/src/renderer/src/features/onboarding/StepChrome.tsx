import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type StepHeadingProps = {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  headingId: string;
  /** The card's footer row, where StepFooter renders the step's buttons. */
  footer: HTMLDivElement | null;
};

export function StepHeader({
  headingRef,
  headingId,
  title,
  children
}: Omit<StepHeadingProps, "footer"> & { title: string; children?: ReactNode }) {
  return (
    <header className="grid gap-[18px]">
      <h1
        ref={headingRef}
        id={headingId}
        tabIndex={-1}
        data-slot="onb-heading"
        className="text-[40px] font-bold leading-[1.2] tracking-[-0.02em] text-fg outline-none"
      >
        {title}
      </h1>
      {children ? (
        <div className="grid gap-2 text-[16.5px] leading-[1.55] text-fg-muted">{children}</div>
      ) : null}
    </header>
  );
}

/**
 * The step's buttons, rendered into the card's footer row: three equal slots, `[Back] [secondary]
 * [primary]`, every button filling its slot, so the buttons are one size on every step and never
 * move. An empty slot keeps its space.
 */
export function StepFooter({
  footer,
  back,
  secondary,
  primary
}: {
  footer: HTMLDivElement | null;
  back?: () => void;
  secondary?: ReactNode;
  primary: ReactNode;
}) {
  if (!footer) return null;
  return createPortal(
    <div className="grid grid-cols-3 gap-[10px]">
      <div className="flex min-w-0">
        {back ? (
          <SecondaryButton data-slot="onb-back" onClick={back}>
            <ArrowLeft />
            Back
          </SecondaryButton>
        ) : null}
      </div>
      <div className="flex min-w-0">{secondary}</div>
      <div className="flex min-w-0">{primary}</div>
    </div>,
    footer
  );
}

/** One box for every footer button; hover changes colour only (no lift, no press scale). */
const footerButton =
  "h-[48px] w-full min-w-0 rounded-[12px] px-3 text-[15px] font-semibold active:scale-100 [&_svg]:size-[15px]";

/** The footer's primary button (accent): fills its slot. Icons go before the label. */
export function PrimaryButton({ className, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="primary"
      data-slot="onb-primary"
      className={cn(footerButton, className)}
      {...props}
    />
  );
}

/** The footer's outlined button (Back, Skip): fills its slot, the same box as the primary. */
export function SecondaryButton({ className, ...props }: React.ComponentProps<typeof Button>) {
  return <Button variant="outline" className={cn(footerButton, className)} {...props} />;
}
