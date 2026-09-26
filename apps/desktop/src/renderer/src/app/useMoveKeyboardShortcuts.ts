import { useEffect } from "react";
import { useGameStore } from "../stores/game-store";

/** Elements whose own keyboard handling must not also step through the game. */
const KEYBOARD_WIDGET_SELECTOR =
  '[role="tablist"], [role="radiogroup"], [role="menu"], [role="menubar"], [role="listbox"], [role="slider"], [role="combobox"], [role="spinbutton"]';

function ownsKeyboard(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }
  if (target.isContentEditable) return true;
  // Composite widgets own their arrow/Home/End keys (tab bars, segmented pickers, menus, lists).
  return Boolean(target.closest(KEYBOARD_WIDGET_SELECTOR));
}

/** ← → step through the current line, Home jumps to the start, End to the end of the line. */
export function useMoveKeyboardShortcuts(): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (ownsKeyboard(event.target) || ownsKeyboard(document.activeElement)) return;

      const game = useGameStore.getState();
      switch (event.key) {
        case "ArrowLeft":
          game.undo();
          break;
        case "ArrowRight":
          game.redo();
          break;
        case "Home":
          game.goToNode("root");
          break;
        case "End": {
          const lineEnd = lastNodeOfLine(game.moveTree, game.currentNodeId);
          if (lineEnd !== game.currentNodeId) game.goToNode(lineEnd);
          break;
        }
        default:
          return;
      }
      event.preventDefault();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}

/** Follows first children from `nodeId` to the end of its line. */
export function lastNodeOfLine(moveTree: readonly { id: string; children: string[] }[], nodeId: string): string {
  const byId = new Map(moveTree.map((node) => [node.id, node]));
  let current = nodeId;
  const seen = new Set<string>();
  for (let next = byId.get(current)?.children[0]; next && !seen.has(next); next = byId.get(current)?.children[0]) {
    seen.add(next);
    current = next;
  }
  return current;
}
