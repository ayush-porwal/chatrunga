import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type IconButtonProps = Omit<ButtonProps, "size" | "children" | "aria-label"> & {
  /** Accessible name AND tooltip text. Required — icon-only buttons must be labelled. */
  label: string;
  icon: React.ReactNode;
  size?: "icon" | "icon-sm" | "icon-xs";
  tooltipSide?: "top" | "right" | "bottom" | "left";
  /** Set false to skip the tooltip (e.g. the label is already visible nearby). */
  tooltip?: boolean;
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
  ...props
}: IconButtonProps) {
  const button = (
    <Button type="button" variant={variant} size={size} aria-label={label} {...props}>
      {icon}
    </Button>
  );
  if (!tooltip) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side={tooltipSide}>{label}</TooltipContent>
    </Tooltip>
  );
});

export { IconButton };
