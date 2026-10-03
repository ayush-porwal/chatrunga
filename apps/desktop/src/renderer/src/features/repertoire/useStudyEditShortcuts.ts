import { useEffect } from "react";
import { isElectronMac } from "@/lib/environment";
import { useEventCallback } from "@/lib/use-event-callback";
import { isTyping, OVERLAY_SELECTOR } from "../../app/useBoardShortcuts";
import { studyEditShortcut, type StudyEditAction } from "./study-edit-shortcuts";

/** Composite widgets that own their letter keys (typeahead). */
const LETTER_WIDGET_SELECTOR = '[role="menu"], [role="listbox"], [role="radiogroup"]';

/**
 * Undo / Redo / Promote variation from the keyboard on the Study page (see study-edit-shortcuts).
 * While a text field has focus its keys are its own, so ⌘Z there is the field's native undo; a
 * dialog or menu open blocks them too.
 */
export function useStudyEditShortcuts({
  enabled,
  onAction
}: {
  enabled: boolean;
  onAction: (action: StudyEditAction) => void;
}): void {
  const handleKeyDown = useEventCallback((event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (isTyping(event.target) || isTyping(document.activeElement)) return;
    if (document.querySelector(OVERLAY_SELECTOR)) return;
    const action = studyEditShortcut(event, isElectronMac());
    if (!action) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (action === "promote" && target?.closest(LETTER_WIDGET_SELECTOR)) return;
    event.preventDefault();
    onAction(action);
  });

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, handleKeyDown]);
}
