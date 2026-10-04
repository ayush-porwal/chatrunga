import { memo, useEffect, useMemo } from "react";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import { useEventCallback } from "@/lib/use-event-callback";
import { isTyping, OVERLAY_SELECTOR } from "../../app/useBoardShortcuts";
import { lastNodeOfLine, nodeAfterSteps } from "../../app/useMoveKeyboardShortcuts";
import { markRapidNavigation } from "../board/board-motion";
import { MoveNavigationBar } from "../board/MoveNavigationBar";

const ROOT_ID = "root";

/** Composite widgets that own their own arrow keys. */
const KEYBOARD_WIDGET_SELECTOR =
  '[role="tablist"], [role="radiogroup"], [role="menu"], [role="listbox"], [role="slider"], [aria-haspopup]';

/**
 * First / Previous · "n / N" · Next / Last over a chapter tree, store-free (the game's
 * MoveNavigation is bound to the game store). Next follows first children.
 */
export const RepertoireMoveNavigation = memo(function RepertoireMoveNavigation({
  nodes,
  selectedNodeId,
  onSelect
}: {
  nodes: readonly MoveNode[];
  selectedNodeId: string;
  onSelect: (nodeId: string) => void;
}) {
  const { depth, total, canPrevious, canNext, lastId, parentId, nextId } = useMemo(() => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const current = byId.get(selectedNodeId) ?? null;
    const last = lastNodeOfLine(nodes, selectedNodeId);
    const lastPly = byId.get(last)?.ply ?? 0;
    const rootPly = byId.get(ROOT_ID)?.ply ?? 0;
    return {
      depth: (current?.ply ?? rootPly) - rootPly,
      total: lastPly - rootPly,
      canPrevious: Boolean(current?.parentId),
      canNext: Boolean(current?.children[0]),
      lastId: last,
      parentId: current?.parentId ?? null,
      nextId: current?.children[0] ?? null
    };
  }, [nodes, selectedNodeId]);

  const goFirst = useEventCallback(() => onSelect(ROOT_ID));
  const goPrevious = useEventCallback(() => {
    if (parentId) onSelect(parentId);
  });
  const goNext = useEventCallback(() => {
    if (nextId) onSelect(nextId);
  });
  const goLast = useEventCallback(() => onSelect(lastId));

  return (
    <MoveNavigationBar
      depth={depth}
      total={total}
      canPrevious={canPrevious}
      canNext={canNext}
      onFirst={goFirst}
      onPrevious={goPrevious}
      onNext={goNext}
      onLast={goLast}
    />
  );
});

/**
 * ← → step through the chapter's current line, Home / End jump to its start / end — the same keys
 * as the game board, for a store-free tree. Ignored while typing, in a dialog or menu, and in
 * composite widgets that own their arrow keys.
 */
export function useTreeKeyboardNavigation({
  enabled,
  nodes,
  selectedNodeId,
  onSelect
}: {
  enabled: boolean;
  nodes: readonly MoveNode[];
  selectedNodeId: string;
  onSelect: (nodeId: string) => void;
}) {
  const handleKeyDown = useEventCallback((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTyping(event.target) || isTyping(document.activeElement)) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest(KEYBOARD_WIDGET_SELECTOR)) return;
    if (document.querySelector(OVERLAY_SELECTOR)) return;
    let next: string;
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowRight":
        if (event.repeat) markRapidNavigation();
        next = nodeAfterSteps(nodes, selectedNodeId, event.key === "ArrowLeft" ? -1 : 1);
        break;
      case "Home":
        next = ROOT_ID;
        break;
      case "End":
        next = lastNodeOfLine(nodes, selectedNodeId);
        break;
      default:
        return;
    }
    event.preventDefault();
    if (next !== selectedNodeId) onSelect(next);
  });

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, handleKeyDown]);
}
