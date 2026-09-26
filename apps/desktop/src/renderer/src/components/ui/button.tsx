import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Variants:
 * - `primary`   the one main action of a region (accent tint).
 * - `default`   neutral filled button.
 * - `outline`   neutral bordered button for secondary actions.
 * - `ghost`     borderless; toolbars, icon buttons, nav items.
 * - `link`      inline text action ("Done", "Retry", "Show solution").
 * - `ghost-destructive` for delete/resign.
 * Sizes: xs (h-7) · sm (h-8) · default (h-9) · icon-xs (7) · icon-sm (8) · icon (9).
 * Icons inside a Button are sized automatically (16px; 14px for xs/sm/icon-xs) — don't pass `size`.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium outline-none transition-[background-color,border-color,color,box-shadow] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:ring-[3px] focus-visible:ring-accent/40",
  {
    variants: {
      variant: {
        default: "border border-line bg-control text-fg hover:bg-control-hover",
        primary: "border border-accent/35 bg-accent-soft text-accent-fg hover:border-accent/50 hover:bg-accent/25 hover:text-fg",
        outline: "border border-line bg-transparent text-fg-secondary hover:bg-control hover:text-fg",
        ghost: "border border-transparent bg-transparent text-fg-muted hover:bg-control hover:text-fg",
        link: "h-auto border-0 bg-transparent p-0 text-fg-muted underline-offset-4 hover:text-fg hover:underline focus-visible:ring-0 focus-visible:underline",
        "ghost-destructive": "border border-transparent bg-transparent text-danger/80 hover:bg-danger-soft hover:text-danger"
      },
      size: {
        default: "h-9 px-3",
        xs: "h-7 gap-1.5 rounded-md px-2 text-xs [&_svg]:size-3.5",
        sm: "h-8 gap-1.5 px-2.5 text-xs [&_svg]:size-3.5",
        icon: "size-9",
        "icon-sm": "size-8",
        "icon-xs": "size-7 rounded-md [&_svg]:size-3.5"
      }
    },
    compoundVariants: [{ variant: "link", className: "h-auto px-0" }],
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, type ButtonProps };
