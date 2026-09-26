import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Collapsible section for rarely-used options ("Advanced", "Custom colors", "Show solution").
 * Never delete a feature — tuck it in here instead.
 *
 *   <Disclosure title="Advanced search limits" summary="1000 ms · no depth cap">
 *     ...fields
 *   </Disclosure>
 */
function Disclosure({
  title,
  summary,
  children
}: {
  title: React.ReactNode;
  /** Short current-value summary shown on the right while collapsed. */
  summary?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = React.useState(false);
  const contentId = React.useId();

  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={contentId}
        onClick={() => setIsOpen((open) => !open)}
        className="group flex min-h-8 w-full items-center gap-1.5 rounded-md text-left text-sm font-medium text-fg-secondary outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        <ChevronRight className={cn("size-4 shrink-0 text-fg-subtle transition-transform", isOpen && "rotate-90")} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {summary && !isOpen ? <span className="shrink-0 truncate text-xs font-normal text-fg-subtle">{summary}</span> : null}
      </button>
      {isOpen ? (
        <div id={contentId} className="pt-2 pl-5.5">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export { Disclosure };
