import * as React from "react";
import { cn } from "@/lib/utils";
import { eyebrow } from "@/lib/ui";

/**
 * Label/value pair (Accuracy 92/100, Provider Lichess, Depth 15), without chrome — inside a card,
 * a row of stats or a <StatGroup>. `mono` for engine numbers/scores.
 */
function Stat({
  label,
  value,
  mono = false,
  valueClassName,
  className
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  mono?: boolean;
  valueClassName?: string;
  className?: string;
}) {
  return (
    <div className={cn("grid min-w-0 gap-0.5", className)}>
      <span className={eyebrow}>{label}</span>
      <span className={cn("truncate text-sm font-semibold text-fg tabular-nums", mono && "font-mono font-medium", valueClassName)}>
        {value}
      </span>
    </div>
  );
}

/**
 * Quiet inline strip of plain stats (label above value) — no boxes, no dividers.
 *
 *   <StatGroup><Stat label="Accuracy" value="92" /><Stat label="Avg loss" value="61cp" /></StatGroup>
 */
function StatGroup({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("grid auto-cols-fr grid-flow-col gap-4", className)}>
      {children}
    </div>
  );
}

export { Stat, StatGroup };
