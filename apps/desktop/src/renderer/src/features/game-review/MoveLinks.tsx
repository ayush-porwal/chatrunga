import type { ReactNode } from "react";
import { CornerUpLeft, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/utils";
import { useBoardPreview, type BoardPreview } from "./board-preview";
import type { MoveNavigationTarget } from "./commentary-moves";

export type GoToLine = (target: MoveNavigationTarget) => void;

/**
 * An inline move that jumps the board, move tree and graph to its position. With `preview`, the
 * pointer resting on it (or keyboard focus) shows the move on Game review's board for a moment.
 */
export function MoveLink({
  san,
  children,
  onActivate,
  className,
  nativeTitle = true,
  label,
  preview = null
}: {
  san: string;
  children?: ReactNode;
  onActivate: () => void;
  className?: string;
  /** What activating it does, for assistive tech (default: going to the move's position). */
  label?: string;
  /** The browser's "Go to …" hint; off where the position itself shows on hover (engine lines). */
  nativeTitle?: boolean;
  /** The move on the position before it, shown on the board while hovered or focused. */
  preview?: BoardPreview | null;
}) {
  const { handlers: previewHandlers, end } = useBoardPreview(preview);
  return (
    <button
      type="button"
      aria-label={label ?? `Go to ${san} position`}
      title={nativeTitle ? `Go to ${san}` : undefined}
      {...previewHandlers}
      onClick={() => {
        // The board goes where the move leads: the preview of where it starts ends first.
        end();
        onActivate();
      }}
      className={cn(
        // The tint and underline fade in; the padding is paid back by the negative margin so the
        // prose never shifts on hover.
        "-mx-[2px] cursor-pointer rounded-[3px] px-[2px] text-accent underline decoration-transparent decoration-1 underline-offset-[3px] outline-none",
        "transition-[background-color,text-decoration-color,color] duration-micro ease-standard",
        "hover:bg-accent/12 hover:decoration-current focus-visible:bg-accent/12 focus-visible:decoration-current focus-visible:ring-2 focus-visible:ring-accent/50",
        className
      )}
    >
      {children ?? san}
    </button>
  );
}

/** The info band's subject: a variation of the game, or a scratch line (`scratch`: never saved). */
export type VariationAnchor = { label: string; scratch?: boolean; onBack: () => void };

/**
 * "Exploring a variation from 6… ♘f6" (a scratch line: "Trying moves from 6… ♘f6 · not saved") with
 * Back to game, as an info band: shown while the board is off the reviewed line (the panel then
 * shows the move the line leaves the game from).
 */
export function VariationAnchorNote({ label, scratch = false, onBack }: VariationAnchor) {
  return (
    <Notice
      tone="info"
      icon={<GitBranch />}
      className="items-center"
      action={
        <Button variant="ghost" size="xs" onClick={onBack}>
          <CornerUpLeft />
          Back to game
        </Button>
      }
    >
      {scratch ? "Trying moves from " : "Exploring a variation from "}
      <span className="font-mono text-fg">{label}</span>
      {scratch ? " · not saved" : null}
    </Notice>
  );
}
