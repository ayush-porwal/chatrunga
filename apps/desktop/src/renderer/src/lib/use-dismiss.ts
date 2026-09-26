import { useEffect, type RefObject } from "react";

/**
 * While `open`, calls `onDismiss` on a pointer press outside `rootRef` or on Escape — the close
 * behaviour shared by the app's popovers (menus, listboxes).
 */
export function useDismiss(rootRef: RefObject<HTMLElement | null>, open: boolean, onDismiss: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onDismiss();
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
