import { useEffect } from "react";
import { markRapidNavigation } from "../features/board/board-motion";
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

type FrameScheduler = { request: (callback: () => void) => number; cancel: (handle: number) => void };

const animationFrames: FrameScheduler = {
  request: (callback) => window.requestAnimationFrame(callback),
  cancel: (handle) => window.cancelAnimationFrame(handle)
};

/**
 * Coalesces ← / → steps into at most one board update per animation frame. Holding a key (or
 * mashing it) never queues a backlog of positions: steps that arrive within one frame are summed
 * and applied as a single jump on the next frame.
 */
export function createStepScheduler(apply: (delta: number) => void, frames: FrameScheduler = animationFrames) {
  let pending = 0;
  let handle: number | null = null;
  return {
    step(delta: number) {
      pending += delta;
      if (handle !== null) return;
      handle = frames.request(() => {
        handle = null;
        const delta = pending;
        pending = 0;
        if (delta) apply(delta);
      });
    },
    cancel() {
      if (handle !== null) frames.cancel(handle);
      handle = null;
      pending = 0;
    }
  };
}

/** ← → step through the current line, Home jumps to the start, End to the end of the line. */
export function useMoveKeyboardShortcuts(): void {
  useEffect(() => {
    const steps = createStepScheduler((delta) => {
      const game = useGameStore.getState();
      const target = nodeAfterSteps(game.moveTree, game.currentNodeId, delta);
      if (target !== game.currentNodeId) game.goToNode(target);
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (ownsKeyboard(event.target) || ownsKeyboard(document.activeElement)) return;

      const game = useGameStore.getState();
      switch (event.key) {
        case "ArrowLeft":
        case "ArrowRight":
          // A held key scrubs: the board snaps between positions instead of sliding each one.
          if (event.repeat) markRapidNavigation();
          steps.step(event.key === "ArrowLeft" ? -1 : 1);
          break;
        case "Home":
          steps.cancel();
          game.goToNode("root");
          break;
        case "End": {
          steps.cancel();
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
    return () => {
      steps.cancel();
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);
}

type LineNode = { id: string; parentId?: string | null; children: string[] };

/** The node `delta` plies away along the current line (negative: back towards the root; positive: first children). */
export function nodeAfterSteps(moveTree: readonly LineNode[], nodeId: string, delta: number): string {
  const byId = new Map(moveTree.map((node) => [node.id, node]));
  let current = nodeId;
  for (let remaining = Math.abs(delta); remaining > 0; remaining -= 1) {
    const node = byId.get(current);
    const next = delta < 0 ? node?.parentId : node?.children[0];
    if (!next || !byId.has(next)) break;
    current = next;
  }
  return current;
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
