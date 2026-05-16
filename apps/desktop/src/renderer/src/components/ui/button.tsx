import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium outline-none transition-[background-color,border-color,color,box-shadow] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:border-[#8fb66f] focus-visible:ring-[3px] focus-visible:ring-[#8fb66f]/35",
  {
    variants: {
      variant: {
        default:
          "border border-white/10 bg-[#25282d] text-[#f4f1ea] shadow-sm hover:bg-[#2d3238]",
        destructive:
          "border border-red-400/25 bg-red-950/35 text-red-100 hover:bg-red-950/55",
        ghost: "border border-transparent bg-transparent text-[#d8dbe0] hover:bg-white/7",
        outline:
          "border border-white/10 bg-transparent text-[#f4f1ea] hover:bg-white/7",
        secondary:
          "border border-[#8fb66f]/35 bg-[#8fb66f]/18 text-[#f6ffe9] hover:bg-[#8fb66f]/24"
      },
      size: {
        default: "h-9 px-3 py-2",
        sm: "h-8 rounded-md px-2.5 text-xs",
        lg: "h-10 rounded-md px-4",
        icon: "size-9"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
