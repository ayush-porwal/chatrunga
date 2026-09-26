import { memo, useMemo, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, SkipBack, SkipForward } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { useEventCallback } from "@/lib/use-event-callback";
import { useGameStore } from "../../stores/game-store";

// Hoisted so the memoised IconButtons skip the per-move re-render of this footer.
const firstIcon = <SkipBack />;
const previousIcon = <ChevronLeft />;
const nextIcon = <ChevronRight />;
const lastIcon = <SkipForward />;

/**
 * Workspace panel footer: First / Previous · "n / N" · Next / Last, wired to the game store
 * (the same navigation as the ← → Home End shortcuts). Shared by the game view and Game review.
 */
export const MoveNavigation = memo(function MoveNavigation({ caption }: { caption?: ReactNode }) {
  const moveTree = useGameStore((state) => state.moveTree);
  const currentNodeId = useGameStore((state) => state.currentNodeId);
  const goToNode = useGameStore((state) => state.goToNode);
  const undo = useGameStore((state) => state.undo);
  const redo = useGameStore((state) => state.redo);

  const { rootId, depth, total, canPrevious, canNext, lastId } = useMemo(() => {
    const byId = new Map(moveTree.map((node) => [node.id, node]));
    const root = moveTree.find((node) => !node.parentId) ?? null;
    const current = byId.get(currentNodeId) ?? null;
    let ply = 0;
    const seen = new Set<string>();
    for (let cursor = current; cursor?.parentId && !seen.has(cursor.id); cursor = byId.get(cursor.parentId) ?? null) {
      seen.add(cursor.id);
      ply += 1;
    }
    let mainline = 0;
    for (let cursor = root; cursor?.children[0]; cursor = byId.get(cursor.children[0]) ?? null) {
      mainline += 1;
      if (mainline > moveTree.length) break;
    }
    let last = current;
    for (let guard = 0; last?.children[0] && guard <= moveTree.length; guard += 1) {
      last = byId.get(last.children[0]) ?? null;
    }
    return {
      rootId: root?.id ?? "root",
      depth: ply,
      // Position within the game: the main line's length, or the line's depth inside a longer variation.
      total: Math.max(ply, mainline),
      canPrevious: Boolean(current?.parentId),
      canNext: Boolean(current?.children[0]),
      lastId: last?.id ?? null
    };
  }, [currentNodeId, moveTree]);

  const goFirst = useEventCallback(() => goToNode(rootId));
  const goLast = useEventCallback(() => {
    if (lastId && lastId !== currentNodeId) goToNode(lastId);
  });

  return (
    <nav className="flex items-center justify-between gap-2 px-3 py-2" aria-label="Move navigation">
      <div className="flex items-center gap-1">
        <IconButton label="First move" icon={firstIcon} variant="outline" tooltipSide="top" disabled={!canPrevious} onClick={goFirst} />
        <IconButton label="Previous move" icon={previousIcon} variant="outline" tooltipSide="top" disabled={!canPrevious} onClick={undo} />
      </div>
      <div className="grid min-w-0 justify-items-center gap-0.5 text-center">
        <p className="font-mono text-xs text-fg-secondary tabular-nums">{total ? `${depth} / ${total}` : "—"}</p>
        {caption ? <p className="text-2xs text-fg-subtle tabular-nums">{caption}</p> : null}
      </div>
      <div className="flex items-center gap-1">
        <IconButton label="Next move" icon={nextIcon} variant="outline" tooltipSide="top" disabled={!canNext} onClick={redo} />
        <IconButton
          label="Last move"
          icon={lastIcon}
          variant="outline"
          tooltipSide="top"
          disabled={!canNext}
          onClick={goLast}
        />
      </div>
    </nav>
  );
});
