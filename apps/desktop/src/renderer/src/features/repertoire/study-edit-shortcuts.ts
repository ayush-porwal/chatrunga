/*
 * Keys for editing the Study move tree: Undo / Redo of structural edits (⌘Z / ⇧⌘Z on macOS,
 * Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y elsewhere) and P to promote the selected variation. No other app
 * shortcut uses P.
 */

export type StudyEditAction = "undo" | "redo" | "promote";

export type StudyEditKey = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "repeat"
>;

/** What a key press does to the Study tree, or null when it isn't one of its edit keys. */
export function studyEditShortcut(event: StudyEditKey, mac: boolean): StudyEditAction | null {
  if (event.altKey) return null;
  const key = event.key.toLowerCase();
  const command = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (command) {
    if (key === "z") return event.shiftKey ? "redo" : "undo";
    if (key === "y" && !mac && !event.shiftKey) return "redo";
    return null;
  }
  if (event.metaKey || event.ctrlKey || event.repeat) return null;
  return key === "p" ? "promote" : null;
}

/** The keys shown in the buttons' titles and announced through aria-keyshortcuts. */
export function studyEditShortcutLabels(
  mac: boolean
): Record<StudyEditAction, { label: string; aria: string }> {
  return mac
    ? {
        undo: { label: "⌘Z", aria: "Meta+Z" },
        redo: { label: "⇧⌘Z", aria: "Shift+Meta+Z" },
        promote: { label: "P", aria: "P" }
      }
    : {
        undo: { label: "Ctrl+Z", aria: "Control+Z" },
        redo: { label: "Ctrl+Y", aria: "Control+Y Control+Shift+Z" },
        promote: { label: "P", aria: "P" }
      };
}
