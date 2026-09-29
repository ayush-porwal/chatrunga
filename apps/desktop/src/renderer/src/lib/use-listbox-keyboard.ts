import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

/**
 * Keyboard for a button-triggered listbox (WAI-ARIA "select-only combobox" pattern): ↓/↑/Enter/Space
 * open it; while open ↓/↑ move, Home/End jump, Enter/Space choose, Escape/Tab close. The trigger
 * keeps focus and points at the highlighted option with `aria-activedescendant` (`optionId(i)`).
 * Disabled options are skipped.
 */
export function useListboxKeyboard({
  id,
  count,
  selectedIndex,
  isDisabled = () => false,
  open,
  setOpen,
  onCommit
}: {
  id: string;
  count: number;
  selectedIndex: number;
  isDisabled?: (index: number) => boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  onCommit: (index: number) => void;
}) {
  const [highlightedIndex, setHighlightedIndex] = useState(Math.max(0, selectedIndex));
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionId = useCallback((index: number) => `${id}-opt-${index}`, [id]);

  // Opening the list (or a new value) highlights the selected option.
  useEffect(() => {
    setHighlightedIndex(Math.max(0, selectedIndex));
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(optionId(highlightedIndex))?.scrollIntoView({ block: "nearest" });
  }, [open, highlightedIndex, optionId]);

  const commit = useCallback(
    (index: number) => {
      if (isDisabled(index)) return;
      onCommit(index);
      setOpen(false);
      triggerRef.current?.focus();
    },
    [isDisabled, onCommit, setOpen]
  );

  /** The next enabled option `delta` steps away (wrapping); `from` itself if none. */
  function step(from: number, delta: number): number {
    for (let offset = 1; offset <= count; offset += 1) {
      const next = (((from + delta * offset) % count) + count) % count;
      if (!isDisabled(next)) return next;
    }
    return from;
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setHighlightedIndex((index) => step(index, 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setHighlightedIndex((index) => step(index, -1));
        break;
      case "Home":
        event.preventDefault();
        setHighlightedIndex(step(count - 1, 1));
        break;
      case "End":
        event.preventDefault();
        setHighlightedIndex(step(0, -1));
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        commit(highlightedIndex);
        break;
      case "Escape":
        event.preventDefault();
        setOpen(false);
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        break;
    }
  }

  return { highlightedIndex, setHighlightedIndex, triggerRef, optionId, commit, onTriggerKeyDown };
}
