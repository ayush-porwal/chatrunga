import { useEffect, type RefObject } from "react";

/**
 * While `open`, calls `onDismiss` on a pointer press outside `rootRef` or on Escape — the close
 * behaviour shared by the app's popovers (menus, listboxes). A popover portalled out of its
 * trigger's tree passes both elements: a press in either is inside.
 */
export function useDismiss(
  rootRef: RefObject<HTMLElement | null> | readonly RefObject<HTMLElement | null>[],
  open: boolean,
  onDismiss: () => void
): void {
  useEffect(() => {
    if (!open) return;
    const roots = "current" in rootRef ? [rootRef] : rootRef;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (!roots.some((root) => root.current?.contains(target))) onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [rootRef, open, onDismiss]);
}
