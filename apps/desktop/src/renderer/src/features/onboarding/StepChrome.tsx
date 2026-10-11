import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type StepHeadingProps = {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  headingId: string;
  /** The frame's footer row, where StepFooter renders the step's buttons. */
  footer: HTMLDivElement | null;
};

export function StepHeader({
  headingRef,
  headingId,
  title,
  children
}: Omit<StepHeadingProps, "footer"> & { title: string; children?: ReactNode }) {
  return (
    <header className="grid gap-3">
      <h1
        ref={headingRef}
        id={headingId}
        tabIndex={-1}
        data-slot="onb-heading"
        className="text-[1.875rem] font-semibold leading-9 tracking-tight text-fg outline-none"
      >
        {title}
      </h1>
      {children ? (
        <div className="grid gap-2 text-sm leading-6 text-fg-muted">{children}</div>
      ) : null}
    </header>
  );
}

/**
 * The step's buttons, rendered into the frame's footer row. The geometry never changes: Back on
 * the left (its slot kept on the first step), the primary action in a fixed-width slot on the
 * right, an optional secondary action just left of it.
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
    <div className="grid h-10 grid-cols-[6rem_minmax(0,1fr)_12.5rem] items-center gap-2">
      {back ? (
        // Pulled left by its padding so the label lines up with the heading's left edge.
        <Button
          variant="ghost"
          data-slot="onb-back"
          className="-ml-3 h-10 w-24 justify-start"
          onClick={back}
        >
          <ArrowLeft />
          Back
        </Button>
      ) : (
        <span aria-hidden className="h-10 w-24" />
      )}
      <div className="flex min-w-0 justify-end">{secondary}</div>
      {primary}
    </div>,
    footer
  );
}

/** The footer's primary button: fills the fixed slot, so its box is the same on every step. */
export function PrimaryButton({ className, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="primary"
      data-slot="onb-primary"
      className={cn("h-10 w-full px-4", className)}
      {...props}
    />
  );
}
