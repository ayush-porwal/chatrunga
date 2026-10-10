import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "@/lib/ui";
import { usePresence } from "@/components/ui/use-presence";

/**
 * Collapsible section for rarely-used options ("Advanced", "Custom colors", "Show solution").
 * Never delete a feature — tuck it in here instead.
 *
 *   <Disclosure title="Advanced search limits" summary="1000 ms · no depth cap">
 *     ...fields
 *   </Disclosure>
 *
 * `variant="panel"` frames it as an accordion — a bordered box with a padded header (title left,
 * summary and chevron right) and a divider above the body — for a section that sits among cards.
 *
 * Motion: the chevron turns and the body grows open (grid rows 0fr → 1fr, content fades in);
 * closing plays it back, then unmounts the body — collapsed content is never kept mounted.
 */
function Disclosure({
  title,
  summary,
  defaultOpen = false,
  onOpenChange,
  variant = "inline",
  children
}: {
  title: React.ReactNode;
  /** Short current-value summary shown on the right while collapsed. */
  summary?: React.ReactNode;
  /** Start expanded (read on mount only), e.g. when the section needs the user's attention. */
  defaultOpen?: boolean;
  /** Told each time the user opens or closes it. */
  onOpenChange?: (open: boolean) => void;
  /** `inline`: a text toggle with the body indented under it; `panel`: a bordered accordion. */
  variant?: "inline" | "panel";
  children: React.ReactNode;
}) {
  const panel = variant === "panel";
  const [isOpen, setIsOpen] = React.useState(defaultOpen);
  const contentId = React.useId();
  const { present } = usePresence(isOpen, motion.ms.standard);
  // The body mounts collapsed and expands on the next frame, so the grid rows have a start value.
  const [expanded, setExpanded] = React.useState(false);
  React.useEffect(() => {
    if (!isOpen) {
      setExpanded(false);
      return;
    }
    const frame = requestAnimationFrame(() => setExpanded(true));
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  return (
    <div className={cn("min-w-0", panel && "rounded-lg border border-line")}>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={contentId}
        onClick={() => {
          setIsOpen(!isOpen);
          onOpenChange?.(!isOpen);
        }}
        className={cn(
          "group flex min-h-8 w-full items-center gap-1.5 rounded-md text-left text-sm font-medium text-fg-secondary outline-none transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/70",
          panel && "min-h-11 gap-3 rounded-lg px-4"
        )}
      >
        {panel ? null : (
          <ChevronRight
            className={cn(
              "size-4 shrink-0 text-fg-subtle transition-transform duration-standard ease-enter",
              isOpen && "rotate-90"
            )}
          />
        )}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {summary ? (
          <span
            className={cn(
              "shrink-0 truncate text-xs font-normal text-fg-subtle transition-opacity duration-micro",
              isOpen && "pointer-events-none opacity-0"
            )}
            aria-hidden={isOpen || undefined}
          >
            {summary}
          </span>
        ) : null}
        {panel ? (
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-fg-subtle transition-transform duration-standard ease-enter",
              isOpen && "rotate-180"
            )}
          />
        ) : null}
      </button>
      {present ? (
        <div
          id={contentId}
          className={cn(
            "grid transition-[grid-template-rows] duration-standard ease-standard",
            expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          )}
        >
          {/* The 4px bleed keeps the children's focus rings clear of the clip. */}
          <div className="-mx-1 -mb-1 min-h-0 overflow-hidden px-1 pb-1">
            <div
              className={cn(
                "transition-opacity duration-standard ease-standard",
                panel ? "border-t border-line-subtle p-4" : "pl-5.5 pt-2",
                expanded ? "opacity-100" : "opacity-0"
              )}
            >
              {children}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export { Disclosure };
