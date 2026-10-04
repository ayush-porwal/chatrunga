import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";
import { frost } from "@/lib/ui";

/** Set while an app-level provider is mounted, so a Tooltip need not bring its own. */
const SharedProvider = React.createContext(false);

/**
 * One provider for the whole app (main.tsx): tooltips share the open delay, and moving from one
 * trigger to its neighbour opens the next tooltip at once (`instant-open`) instead of waiting again.
 */
function TooltipProvider({
  delayDuration = 120,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <SharedProvider.Provider value={true}>
      <TooltipPrimitive.Provider
        data-slot="tooltip-provider"
        delayDuration={delayDuration}
        {...props}
      />
    </SharedProvider.Provider>
  );
}

/** Uses the app's shared provider; outside one (tests, isolated renders) it brings its own. */
function Tooltip(props: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const root = <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
  return React.useContext(SharedProvider) ? root : <TooltipProvider>{root}</TooltipProvider>;
}

function TooltipTrigger(props: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

/**
 * Motion: pops from the trigger side (Radix's transform origin) on a delayed open, fades on an
 * instant open (moving between neighbouring triggers), fades out on close. The Content node itself
 * only carries `animate-hold` while closing so Radix keeps it mounted for the exit; the visible
 * surface animates inside it, above a still frosted layer on glass (see `.ui-frost`).
 */
function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn("group/tooltip relative z-[90] data-[state=closed]:animate-hold", className)}
        {...props}
      >
        <span
          aria-hidden="true"
          className={cn(
            frost,
            "rounded-md animate-fade-in group-data-[state=closed]/tooltip:animate-fade-out"
          )}
        />
        <div
          className={cn(
            "relative overflow-hidden rounded-md border border-line bg-surface-raised px-2 py-1 text-xs text-fg shadow-popover glass:bg-surface-raised/85",
            "origin-(--radix-tooltip-content-transform-origin) animate-pop-in group-data-[state=instant-open]/tooltip:animate-fade-in group-data-[state=closed]/tooltip:animate-fade-out"
          )}
        >
          {children}
        </div>
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
