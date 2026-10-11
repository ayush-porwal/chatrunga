import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A sunken strip of label / value cells, divided by hairlines: Analyze's Depth · Score · Best and
 * Game review's move facts (Played · Best · Eval · Loss).
 *
 *   <StatStrip className="grid-cols-3">
 *     <StatCell label="Depth">24</StatCell>
 *   </StatStrip>
 *
 * The strip sets its columns (`className`); `size="sm"` is the denser cell for longer rows.
 */
function StatStrip({ className, ...props }: React.ComponentProps<"dl">) {
  return (
    <dl
      className={cn("grid rounded-[10px] border border-line bg-surface-sunken", className)}
      {...props}
    />
  );
}

const cellSize = {
  md: { cell: "py-2.5", value: "text-[1.0625rem]" },
  sm: { cell: "py-2", value: "text-[0.9375rem]" }
} as const;

function StatCell({
  label,
  size = "md",
  valueClassName,
  children
}: {
  label: string;
  size?: keyof typeof cellSize;
  /** The value's own tone (a mark's colour, the accent). */
  valueClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid min-w-0 gap-0.5 px-3 [&+&]:border-l [&+&]:border-line-subtle",
        cellSize[size].cell
      )}
    >
      <dt className="text-2xs text-fg-subtle">{label}</dt>
      <dd
        className={cn(
          "truncate font-mono leading-tight font-semibold text-fg tabular-nums",
          cellSize[size].value,
          valueClassName
        )}
      >
        {children}
      </dd>
    </div>
  );
}

export { StatCell, StatStrip };
