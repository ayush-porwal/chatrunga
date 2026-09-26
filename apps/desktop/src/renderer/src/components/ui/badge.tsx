import * as React from "react";
import { X } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Static pill for status/metadata ("installed", "Default", "PUZZLE", result "1-0").
 * Use sparingly: a badge must carry information the surrounding text doesn't.
 */
const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full font-medium [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      tone: {
        neutral: "border border-line text-fg-muted",
        accent: "bg-accent/15 text-accent-fg",
        info: "bg-info/15 text-info",
        warn: "bg-warn/15 text-warn",
        danger: "bg-danger/15 text-danger"
      },
      size: {
        sm: "h-5 px-1.5 text-2xs",
        md: "h-6 px-2 text-xs"
      }
    },
    defaultVariants: { tone: "neutral", size: "sm" }
  }
);

type BadgeProps = React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    /** Renders a remove (×) button — for selected filter chips. */
    onRemove?: () => void;
    removeLabel?: string;
    /** Fade/rise in on mount — for badges that appear in response to something (a new result, a status). */
    appear?: boolean;
  };

function Badge({ className, tone, size, onRemove, removeLabel, appear = false, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, size }), onRemove && "pr-1", appear && "animate-rise-in", className)} {...props}>
      {children}
      {onRemove ? (
        <button
          type="button"
          className="grid size-4 place-items-center rounded-full opacity-70 outline-none transition-[opacity,background-color] hover:bg-white/10 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/70"
          onClick={onRemove}
          aria-label={removeLabel ?? "Remove"}
        >
          <X />
        </button>
      ) : null}
    </span>
  );
}

/**
 * Toggleable filter chip (themes, tags, solution length). Selected = accent tint.
 *
 *   <ChipButton selected={active} onClick={toggle}>fork</ChipButton>
 */
function ChipButton({
  selected = false,
  className,
  ...props
}: React.ComponentProps<"button"> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium outline-none transition-[color,background-color,border-color,box-shadow,scale] duration-micro ease-standard focus-visible:ring-2 focus-visible:ring-accent/70 active:scale-[0.96] disabled:opacity-50 motion-reduce:active:scale-100 [&_svg]:size-3.5",
        selected
          ? "border-accent/45 bg-accent-soft text-accent-fg"
          : "border-line text-fg-muted hover:bg-control hover:text-fg",
        className
      )}
      {...props}
    />
  );
}

export { Badge, ChipButton };
