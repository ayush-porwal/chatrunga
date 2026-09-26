import { useEffect, type RefObject } from "react";
import { prefersReducedMotion } from "./board-motion";

const SHAPE_FADE_IN_MS = 160;
const SHAPE_FADE_OUT_MS = 120;
const RESIZE_SETTLE_MS = 160;

/**
 * Motion finishing for a Chessground board mounted in `elementRef`:
 * - arrows and circles (drawn or automatic) fade in, and fade out instead of vanishing — so a
 *   review arrow switching to the next move cross-fades;
 * - nothing fades while the pointer is down (drawing / dragging) or while the board is resizing
 *   (Chessground re-creates every shape on a size change, which would otherwise shimmer).
 *
 * Works on Chessground's DOM from the outside (a MutationObserver on the shape layers), so it
 * survives Chessground rebuilding its DOM and needs no changes to how boards are configured.
 */
export function useBoardPolish(elementRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const wrap = elementRef.current;
    if (!wrap) return;
    let pointerDown = false;
    let resizing = false;
    let resizeTimer = 0;
    let releaseFrame = 0;

    const quiet = () => pointerDown || resizing || prefersReducedMotion();

    const isShapeRoot = (node: Node | null): node is SVGGElement =>
      node instanceof SVGGElement && node.parentElement instanceof SVGSVGElement && /\bcg-(shapes|shapes-below)\b/.test(node.parentElement.getAttribute("class") ?? "");

    const observer = new MutationObserver((records) => {
      if (quiet()) return;
      for (const record of records) {
        if (!isShapeRoot(record.target)) continue;
        const root = record.target;
        for (const added of record.addedNodes) {
          if (!(added instanceof SVGGElement) || added.dataset.leaving) continue;
          added.animate([{ opacity: 0 }, { opacity: 1 }], { duration: SHAPE_FADE_IN_MS, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
        }
        for (const removed of record.removedNodes) {
          if (!(removed instanceof SVGGElement) || removed.dataset.leaving) continue;
          // A stand-in keeps the old shape on screen while it fades; without a cgHash Chessground
          // treats it as stale and may drop it early on its next sync, which is fine.
          const ghost = removed.cloneNode(true) as SVGGElement;
          ghost.removeAttribute("cgHash");
          ghost.dataset.leaving = "true";
          root.appendChild(ghost);
          const fade = ghost.animate([{ opacity: 1 }, { opacity: 0 }], {
            duration: SHAPE_FADE_OUT_MS,
            easing: "cubic-bezier(0.55, 0, 1, 0.45)",
            fill: "forwards"
          });
          fade.onfinish = () => ghost.remove();
          fade.oncancel = () => ghost.remove();
        }
      }
    });
    observer.observe(wrap, { childList: true, subtree: true });

    const onPointerDown = () => {
      pointerDown = true;
      window.cancelAnimationFrame(releaseFrame);
    };
    const onPointerUp = () => {
      if (!pointerDown) return;
      // Chessground commits a drawn shape on mouseup and paints it on the next frame: stay quiet
      // until that frame has passed so the committed arrow does not blink.
      window.cancelAnimationFrame(releaseFrame);
      releaseFrame = window.requestAnimationFrame(() => {
        releaseFrame = window.requestAnimationFrame(() => {
          pointerDown = false;
        });
      });
    };
    wrap.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    const resizeObserver = new ResizeObserver(() => {
      resizing = true;
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resizing = false;
      }, RESIZE_SETTLE_MS);
    });
    resizeObserver.observe(wrap);
    // The first observation fires on mount; it is not a user resize.
    const settleFirst = window.setTimeout(() => {
      resizing = false;
    }, RESIZE_SETTLE_MS);

    return () => {
      observer.disconnect();
      resizeObserver.disconnect();
      wrap.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.clearTimeout(resizeTimer);
      window.clearTimeout(settleFirst);
      window.cancelAnimationFrame(releaseFrame);
    };
  }, [elementRef]);
}
