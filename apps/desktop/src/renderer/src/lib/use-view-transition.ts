import { useCallback, useRef, useState } from "react";
import { flushSync } from "react-dom";

/** `lift`: the new view rises in (a page is involved). `fade`: plain cross-fade (board ↔ board). */
export type ViewTransitionKind = "lift" | "fade";

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

let activeTransition: { finished: Promise<void> } | null = null;

/** A state update given as a function of the previous value (as React's setState takes it). */
function isUpdater<T>(next: T | ((previous: T) => T)): next is (previous: T) => T {
  return typeof next === "function";
}

/**
 * Runs a React state update inside a View Transition when the browser supports it (Electron's
 * Chromium does): the old view stays on screen until React has rendered the new one, then the
 * content panel and titlebar title animate (styles in app.css, `app-content` / `app-title`).
 * Falls back to a plain synchronous update. The update always runs, even if a newer transition
 * interrupts this one.
 */
export function runViewTransition(update: () => void, kind: ViewTransitionKind = "lift"): void {
  const doc = document as ViewTransitionDocument;
  if (!doc.startViewTransition || document.visibilityState !== "visible") {
    update();
    return;
  }
  const root = document.documentElement;
  root.dataset.viewTransition = kind;
  const transition = doc.startViewTransition(() => flushSync(update));
  activeTransition = transition;
  transition.finished
    .catch(() => undefined)
    .finally(() => {
      if (activeTransition === transition) {
        activeTransition = null;
        delete root.dataset.viewTransition;
      }
    });
}

/**
 * `useState` whose changes animate as a view transition. The setter compares against the value
 * already requested (not the last rendered one), so a second update while a transition is pending —
 * e.g. an effect reacting to a route change — sees the intended value and cannot undo it.
 * `alongside` runs inside the same transition (e.g. a route change that belongs to the view change),
 * or immediately when the value does not change.
 */
export function useViewTransitionState<T>(
  initial: T,
  kindFor: (previous: T, next: T) => ViewTransitionKind = () => "lift"
): [T, (next: T | ((previous: T) => T), alongside?: () => void) => void] {
  const [value, setValue] = useState(initial);
  const intended = useRef(initial);
  // Read once: the kind rule is a pure function of the two values.
  const kindForRef = useRef(kindFor);

  const setWithTransition = useCallback((next: T | ((previous: T) => T), alongside?: () => void) => {
    const previous = intended.current;
    const resolved = isUpdater(next) ? next(previous) : next;
    if (Object.is(resolved, previous)) {
      alongside?.();
      return;
    }
    intended.current = resolved;
    runViewTransition(() => {
      alongside?.();
      setValue(resolved);
    }, kindForRef.current(previous, resolved));
  }, []);

  return [value, setWithTransition];
}
