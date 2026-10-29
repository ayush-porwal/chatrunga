import { Fragment } from "react";
import type { ChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import { playerToMove } from "@chaturanga/shared/chess/repertoire-position";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import { OverflowMenu } from "@/components/ui/menu";
import { SideDot } from "@/components/ui/side-dot";
import { cn } from "@/lib/utils";
import { COLOR_LABELS } from "./repertoire-chapters";
import { moveLabel } from "./study-staging";

/** The moves the strip shows at most: the end of a longer line, after a "…". */
const SHOWN_MOVES = 12;

/** A move as the strip reads it: numbered when White's, or when the shown line starts with it. */
function stripLabel(node: MoveNode, first: boolean): string {
  const san = node.san ?? node.uci ?? "?";
  return first || playerToMove(node.fenBefore) === "white" ? moveLabel(node.fenBefore, san) : san;
}

/**
 * Study's line strip (the panel's summary): the moves from the chapter's start to the selected one
 * as chips, staged ones in the warn tone; after a move the chapter has others beside, a "+N" chip
 * whose menu ("Also in this chapter") jumps to one; then who is to move.
 */
export function StudyLineStrip({
  lookup,
  nodeId,
  staged,
  onSelect
}: {
  lookup: ChapterLookup;
  nodeId: string;
  /** The staged moves' ids. */
  staged: ReadonlySet<string>;
  onSelect: (nodeId: string) => void;
}) {
  const path = (lookup.parentPath.get(nodeId) ?? []).slice(1);
  const shown = path.slice(-SHOWN_MOVES);
  const node = lookup.nodesById.get(nodeId);
  const toMove = node ? playerToMove(node.fenAfter) : "white";
  return (
    <nav
      aria-label="Line"
      className="flex min-w-0 flex-wrap content-center items-center gap-x-0.5 gap-y-1 font-mono text-xs"
    >
      {shown.length < path.length ? (
        <span aria-hidden className="px-1 text-fg-subtle">
          …
        </span>
      ) : null}
      {shown.map((id, index) => {
        const move = lookup.nodesById.get(id)!;
        const siblings = (lookup.childrenById.get(move.parentId ?? "") ?? [])
          .filter((sibling) => sibling !== id)
          .map((sibling) => lookup.nodesById.get(sibling)!);
        const current = id === nodeId;
        return (
          <Fragment key={id}>
            <button
              type="button"
              aria-current={current ? "step" : undefined}
              className={cn(
                "h-6 rounded px-1 outline-none transition-colors duration-micro hover:bg-control focus-visible:ring-2 focus-visible:ring-accent/50",
                staged.has(id) ? "text-warn" : current ? "text-fg" : "text-fg-muted",
                current && "bg-accent-soft font-semibold"
              )}
              onClick={() => onSelect(id)}
            >
              {stripLabel(move, index === 0)}
            </button>
            {siblings.length ? (
              <OverflowMenu
                label="Also in this chapter"
                trigger={{ text: `+${siblings.length}`, variant: "outline", compact: true }}
                items={siblings.map((sibling) => ({
                  label: moveLabel(sibling.fenBefore, sibling.san ?? sibling.uci ?? "?"),
                  onSelect: () => onSelect(sibling.id)
                }))}
              />
            ) : null}
          </Fragment>
        );
      })}
      <span className="ml-1.5 inline-flex items-center gap-1.5 font-sans text-fg-muted">
        <SideDot color={toMove} />
        {COLOR_LABELS[toMove]} to move
      </span>
    </nav>
  );
}
