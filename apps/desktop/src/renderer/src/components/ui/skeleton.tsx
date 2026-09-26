import type * as React from "react";
import { cn } from "@/lib/utils";

type SkeletonProps = React.HTMLAttributes<HTMLElement> & {
  /** `span` for placeholders inside inline or text content (a value, a list row). */
  as?: "div" | "span";
};

/**
 * Loading placeholder: a control-coloured bar that fades in after a short hold and pulses gently
 * (still under reduced motion; `.ui-skeleton` in app.css). Size and radius come from `className`,
 * matched to the content it stands in for so nothing shifts when the data arrives.
 *
 *   <Skeleton className="h-3 w-24" />
 */
export function Skeleton({ as: Tag = "div", className, ...props }: SkeletonProps) {
  return <Tag aria-hidden="true" data-slot="skeleton" className={cn("ui-skeleton block rounded-md bg-control", className)} {...props} />;
}
