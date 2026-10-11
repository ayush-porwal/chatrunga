import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** A field's label row on the steps (Rating, Board, OpenRouter key…). */
export const stepFieldLabel = "text-[13.5px] font-semibold text-fg-secondary";

/** The selected tile's green (rating, side). */
export const tileSelected = "border-[#557a45] bg-[#1b241b]";

/** A bordered list of rows: the engines and the summary. */
export function StepRows({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul aria-label={label} className="overflow-hidden rounded-[12px] border border-line">
      {children}
    </ul>
  );
}

/** One row: a leading tile or icon, a title over a short detail, and what sits at the end. */
export function StepRow({
  lead,
  title,
  detail,
  end
}: {
  lead: ReactNode;
  title: string;
  detail?: ReactNode;
  end?: ReactNode;
}) {
  return (
    <li className="relative flex items-center gap-[16px] border-t border-line-subtle px-[20px] py-[18px] transition-colors duration-[180ms] first:border-t-0 hover:bg-white/[0.02]">
      {lead}
      <span className="grid min-w-0 flex-1 gap-[2px]">
        <b className="truncate text-[15.5px] font-semibold text-fg">{title}</b>
        {detail ? <small className="truncate text-[13.5px] text-fg-subtle">{detail}</small> : null}
      </span>
      {end ? (
        <span className="flex shrink-0 items-center gap-[8px] text-[12.5px] text-fg-muted">
          {end}
        </span>
      ) : null}
    </li>
  );
}

/** A size or count in a small rounded pill. */
export function StepPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-grid h-[20px] min-w-[22px] place-items-center rounded-full bg-control px-[7px] text-[11.5px] font-semibold text-fg-muted tabular-nums">
      {children}
    </span>
  );
}

const bandTone = {
  danger: "bg-[rgb(255_154_141/0.08)] [&>svg]:text-danger",
  info: "bg-[rgb(96_165_250/0.08)] [&>svg]:text-info",
  success: "bg-[rgb(143_182_111/0.08)] [&>svg]:text-accent"
} as const;

/** A one-line band: an icon, a short message, and an action at the end. */
export function StepBand({
  tone,
  icon,
  action,
  children
}: {
  tone: keyof typeof bandTone;
  icon: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex items-center gap-[10px] rounded-[10px] px-[12px] py-[11px] text-[13px] text-fg-secondary [&>svg]:size-[16px] [&>svg]:shrink-0",
        bandTone[tone]
      )}
    >
      {icon}
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}

/**
 * A square icon button with a tooltip (Retry, Try again). The glyph turns a quarter on hover.
 * `label` names it for screen readers and can say more than the tooltip ("Retry Stockfish").
 */
export function StepIconButton({
  label,
  tooltip,
  icon,
  onClick
}: {
  label: string;
  tooltip: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={label}
          onClick={onClick}
          className="size-[34px] rounded-[9px] border-line-strong text-fg-secondary [&_svg]:size-[16px] [&_svg]:transition-transform [&_svg]:duration-[400ms] [&_svg]:ease-[cubic-bezier(0.22,1,0.36,1)] hover:[&_svg]:-rotate-90 motion-reduce:[&_svg]:transition-none"
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
}
