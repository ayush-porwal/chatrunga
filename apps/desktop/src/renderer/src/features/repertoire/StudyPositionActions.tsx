import type { ReactNode } from "react";
import { Microscope, Swords } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * One icon action on the selected position. Unavailable, it stays focusable and hoverable
 * (`aria-disabled`, not `disabled`) so its tooltip can say why; a click then does nothing.
 */
function PositionAction({
  label,
  icon,
  tooltip,
  unavailable,
  pressed,
  className,
  onClick,
  ...aria
}: {
  label: string;
  icon: ReactNode;
  /** What it does (shown when available). */
  tooltip: string;
  /** Why it can't run now (null: it can). */
  unavailable: string | null;
  /** A toggle's state (Analyze). */
  pressed?: boolean;
  className?: string;
  onClick: () => void;
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={pressed ? "primary" : "ghost"}
          size="icon-sm"
          aria-label={label}
          aria-pressed={pressed}
          aria-disabled={unavailable ? true : undefined}
          className={cn(
            unavailable && "cursor-not-allowed opacity-50 hover:bg-transparent",
            className
          )}
          onClick={unavailable ? undefined : onClick}
          {...aria}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-64">
        {unavailable ?? tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

const analyzeIcon = <Microscope />;
const playIcon = <Swords />;

/**
 * Study's actions on the selected position, as icons at the end of the side panel's status row
 * (To move, Decisions): Analyze opens and closes the engine panel just below it (a toggle), Play
 * from here starts an engine game there. Each says in its tooltip why it can't run (a finished
 * position, a Lichess game being played).
 */
export function StudyPositionActions({
  engineOpen,
  enginePanelId,
  analyzeUnavailable,
  onToggleEngine,
  playUnavailable,
  onPlayFromHere
}: {
  engineOpen: boolean;
  enginePanelId: string;
  /** Why the engine panel can't open here (it can always close). */
  analyzeUnavailable: string | null;
  onToggleEngine: () => void;
  playUnavailable: string | null;
  /** Unset: no Play from here (the web preview). */
  onPlayFromHere?: () => void;
}) {
  return (
    <div role="group" aria-label="Position actions" className="flex shrink-0 items-center gap-0.5">
      <PositionAction
        label="Analyze"
        icon={analyzeIcon}
        tooltip={engineOpen ? "Close the engine" : "Analyze this position with the engine"}
        unavailable={engineOpen ? null : analyzeUnavailable}
        pressed={engineOpen}
        aria-expanded={engineOpen}
        aria-controls={engineOpen ? enginePanelId : undefined}
        onClick={onToggleEngine}
      />
      {onPlayFromHere ? (
        <PositionAction
          label="Play from here"
          icon={playIcon}
          tooltip="Play the engine from this position as your repertoire's side"
          unavailable={playUnavailable}
          onClick={onPlayFromHere}
        />
      ) : null}
    </div>
  );
}
