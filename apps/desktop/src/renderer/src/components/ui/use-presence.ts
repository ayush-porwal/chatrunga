import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { motion } from "@/lib/ui";

/**
 * Mount/unmount with an exit animation for component-owned overlays (menus, disclosures):
 * `present` stays true for `exitMs` after `open` turns false, while `state` is already "closed" —
 * render `data-state={state}` and let CSS run the exit (`data-[state=closed]:animate-pop-out`).
 * A timer rather than `animationend`, so reduced motion and interrupted animations never strand it.
 */
export function usePresence(open: boolean, exitMs: number = motion.ms.micro): { present: boolean; state: "open" | "closed" } {
  const [present, setPresent] = useState(open);
  // Adjust state while rendering (React's "storing information from previous renders" pattern):
  // opening mounts in the same render, no extra frame.
  if (open && !present) setPresent(true);
  useEffect(() => {
    if (open || !present) return;
    const timer = window.setTimeout(() => setPresent(false), exitMs);
    return () => window.clearTimeout(timer);
  }, [open, present, exitMs]);
  return { present: open || present, state: open ? "open" : "closed" };
}

/**
 * Exit animation for an element whose parent unmounts it outright (`{open ? <Dialog/> : null}`):
 * on unmount, a static clone of the element is left in <body> with `data-state="closed"` for
 * `durationMs`, so CSS can play the exit, then removed. The clone is inert and hidden from assistive
 * tech; ids are stripped so it never shadows the next instance. Needs `position: fixed` content.
 *
 * StrictMode's simulated unmount keeps the real node attached, which is how it is told apart.
 */
export function useExitGhost(ref: RefObject<HTMLElement | null>, durationMs: number = motion.ms.micro): void {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    return () => {
      const ghost = node.cloneNode(true);
      if (!(ghost instanceof HTMLElement)) return;
      const restoreScroll = captureScrollPositions(node, ghost);
      queueMicrotask(() => {
        if (node.isConnected) return;
        ghost.dataset.state = "closed";
        ghost.setAttribute("aria-hidden", "true");
        ghost.inert = true;
        ghost.style.pointerEvents = "none";
        ghost.removeAttribute("id");
        for (const element of ghost.querySelectorAll("[id]")) element.removeAttribute("id");
        document.body.appendChild(ghost);
        restoreScroll();
        window.setTimeout(() => ghost.remove(), durationMs + 40);
      });
    };
  }, [ref, durationMs]);
}

/**
 * Clones start scrolled to the top. Reads the scrolled regions now (the node is still attached) and
 * returns a function that applies them to the clone once it is in the document.
 */
function captureScrollPositions(source: HTMLElement, clone: HTMLElement): () => void {
  // Scroll regions are `.scroll-area` by convention; the same selector walks both trees in step.
  const from = [source, ...source.querySelectorAll<HTMLElement>(".scroll-area")];
  const to = [clone, ...clone.querySelectorAll<HTMLElement>(".scroll-area")];
  const scrolled: { target: HTMLElement; top: number; left: number }[] = [];
  from.forEach((element, index) => {
    const target = to[index];
    if (target && (element.scrollTop || element.scrollLeft)) {
      scrolled.push({ target, top: element.scrollTop, left: element.scrollLeft });
    }
  });
  return () => {
    for (const { target, top, left } of scrolled) {
      target.scrollTop = top;
      target.scrollLeft = left;
    }
  };
}
