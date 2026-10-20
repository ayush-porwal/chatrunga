import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type IconButtonProps = Omit<ButtonProps, "size" | "children" | "aria-label"> & {
  /** Accessible name AND tooltip text. Required — icon-only buttons must be labelled. */
  label: string;
  icon: React.ReactNode;
  size?: "icon" | "icon-sm" | "icon-xs";
  tooltipSide?: "top" | "right" | "bottom" | "left";
  /** Set false to skip the tooltip (e.g. the label is already visible nearby). */
  tooltip?: boolean;
  /**
   * Why the button is disabled, shown as its tooltip. It then stays hoverable (aria-disabled
   * instead of disabled, as SegmentedControl's segments do) so the reason can be read; it still
   * can't be pressed.
   */
  disabledReason?: string;
};

/**
 * Icon-only button with tooltip. Default: ghost, 32px (`icon-sm`).
 *
 *   <IconButton label="Flip board" icon={<Repeat2 />} onClick={flip} />
 *
 * Memoised: with a hoisted icon element and a stable onClick it skips its parent's re-renders
 * (each one is a Radix tooltip tree of ~17 components).
 */
const IconButton = React.memo(function IconButton({
  label,
  icon,
  size = "icon-sm",
  variant = "ghost",
  tooltipSide = "bottom",
  tooltip = true,
  disabledReason,
  disabled,
  onClick,
  className,
  ...props
}: IconButtonProps) {
  const explained = Boolean(disabled && disabledReason);
  const button = (
    <Button
      type="button"
      variant={variant}
      size={size}
      aria-label={label}
      aria-disabled={explained || undefined}
      disabled={disabled && !explained}
      onClick={explained ? undefined : onClick}
      className={cn(
        explained && "cursor-not-allowed opacity-50 hover:bg-transparent active:scale-100",
        className
      )}
      {...props}
    >
      {icon}
    </Button>
  );
  if (!tooltip && !explained) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side={tooltipSide}>{explained ? disabledReason : label}</TooltipContent>
    </Tooltip>
  );
});

export { IconButton };
