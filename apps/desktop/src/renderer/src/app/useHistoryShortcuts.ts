import { useEffect } from "react";
import { isElectronMac } from "@/lib/environment";
import { useEventCallback } from "@/lib/use-event-callback";
import { isTyping, OVERLAY_SELECTOR } from "./useBoardShortcuts";

/** Back / Forward key hints, for the titlebar buttons' tooltips. */
export function historyShortcutLabels(): { back: string; forward: string } {
  return isElectronMac() ? { back: "⌘[", forward: "⌘]" } : { back: "Alt+←", forward: "Alt+→" };
}

/**
 * Back / Forward from the keyboard (⌘[ ⌘] on macOS, Alt+← Alt+→ elsewhere, like browsers) and the
 * mouse's back/forward buttons. Plain arrows stay with the move list. Ignored while typing or
 * while a dialog or menu is open.
 */
export function historyShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  mac: boolean
): "back" | "forward" | null {
  if (event.shiftKey) return null;
  if (mac && event.metaKey && !event.ctrlKey && !event.altKey) {
    if (event.key === "[") return "back";
    if (event.key === "]") return "forward";
  }
  if (!mac && event.altKey && !event.metaKey && !event.ctrlKey) {
    if (event.key === "ArrowLeft") return "back";
    if (event.key === "ArrowRight") return "forward";
  }
  return null;
}

export function useHistoryShortcuts({ onBack, onForward }: { onBack: () => void; onForward: () => void }): void {
  const handleKeyDown = useEventCallback((event: KeyboardEvent) => {
    if (isTyping(event.target) || isTyping(document.activeElement) || document.querySelector(OVERLAY_SELECTOR)) return;
    const action = historyShortcut(event, isElectronMac());
    if (!action) return;
    event.preventDefault();
    if (action === "back") onBack();
    else onForward();
  });
  // Mouse buttons 3 / 4 are Back / Forward.
  const handleMouseUp = useEventCallback((event: MouseEvent) => {
    if (event.button !== 3 && event.button !== 4) return;
    event.preventDefault();
    if (event.button === 3) onBack();
    else onForward();
  });

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleKeyDown, handleMouseUp]);
}
