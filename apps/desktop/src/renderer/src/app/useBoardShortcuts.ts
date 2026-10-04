import { useEffect } from "react";
import { useEventCallback } from "@/lib/use-event-callback";

/** Board-view command keys, shown in the sidebar items' hints and tooltips. */
export const BOARD_SHORTCUTS = { focus: "F", flip: "X" } as const;

/** An open dialog or menu owns Escape (it closes itself); focus mode must not also react to it. */
export const OVERLAY_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="menu"], [role="listbox"]';

/** Text entry keeps its letters and its Escape (inputs, text areas, selects, editable text, comboboxes). */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true;
  }
  return (
    target.isContentEditable ||
    Boolean(
      target.closest('[role="combobox"], [role="textbox"], [role="searchbox"], [role="spinbutton"]')
    )
  );
}

export type BoardShortcutAction = "toggle-focus" | "exit-focus" | "flip";

/** What a key press means on a board view, or null when it is not a board command right now. */
export function boardShortcutAction(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "repeat">,
  { enabled, focused, overlayOpen }: { enabled: boolean; focused: boolean; overlayOpen: boolean }
): BoardShortcutAction | null {
  if (
    !enabled ||
    overlayOpen ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.shiftKey ||
    event.repeat
  ) {
    return null;
  }
  const key = event.key.toUpperCase();
  if (key === BOARD_SHORTCUTS.focus) return "toggle-focus";
  if (key === BOARD_SHORTCUTS.flip) return "flip";
  if (event.key === "Escape" && focused) return "exit-focus";
  return null;
}

/**
 * Board-view command keys: F toggles focus mode, Escape leaves it, X flips the board. Ignored off
 * the board views, while typing in a field, and while a dialog/menu is open (Escape is theirs then).
 */
export function useBoardShortcuts({
  enabled,
  focused,
  onToggleFocus,
  onExitFocus,
  onFlip
}: {
  /** The current view has a board. */
  enabled: boolean;
  focused: boolean;
  onToggleFocus: () => void;
  onExitFocus: () => void;
  onFlip: () => void;
}): void {
  const handleKeyDown = useEventCallback((event: KeyboardEvent) => {
    if (isTyping(event.target) || isTyping(document.activeElement)) return;
    const overlayOpen = Boolean(document.querySelector(OVERLAY_SELECTOR));
    const action = boardShortcutAction(event, { enabled, focused, overlayOpen });
    if (!action) return;
    event.preventDefault();
    if (action === "toggle-focus") onToggleFocus();
    else if (action === "exit-focus") onExitFocus();
    else onFlip();
  });

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
