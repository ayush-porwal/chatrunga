import { useSyncExternalStore } from "react";

/*
 * Board motion: one place for the timings the boards use and the small signals that decide when a
 * position change animates. Durations follow the app's motion tokens (styles/app.css).
 */

/** Piece slide for a single step (a move played, ← / →). */
export const PIECE_MOVE_MS = 180;
/** Highlights (last move, check, legal-move dots) fading in after a step. */
export const HIGHLIGHT_FADE_MS = 140;
/** Position changes closer together than this snap instead of sliding (held keys, fast clicks). */
export const RAPID_STEP_MS = 90;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function reducedMotionQuery(): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(REDUCED_MOTION_QUERY) : null;
}

export function prefersReducedMotion(): boolean {
  return reducedMotionQuery()?.matches ?? false;
}

function subscribeReducedMotion(onChange: () => void): () => void {
  const query = reducedMotionQuery();
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

/** Live `prefers-reduced-motion: reduce` (updates when the system setting changes). */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
}

let lastRapidNavigationAt = -Infinity;

/** Called by the keyboard shortcuts for auto-repeated steps (a held ← / →). */
export function markRapidNavigation(now = performance.now()): void {
  lastRapidNavigationAt = now;
}

/** True while the user is scrubbing (a key is being held): the board snaps instead of sliding. */
export function isRapidNavigation(now = performance.now()): boolean {
  return now - lastRapidNavigationAt < 160;
}

type TreeLink = { id: string; parentId: string | null };

/**
 * Whether going from `fromId` to `toId` is a single step (one ply forwards or back). Only single
 * steps slide pieces; jumps (Home / End, a distant move, a variation elsewhere) snap so the board
 * never flies half the pieces across at once.
 */
export function isSingleStep(moveTree: readonly TreeLink[], fromId: string | null, toId: string): boolean {
  if (!fromId || fromId === toId) return false;
  for (const node of moveTree) {
    if (node.id === toId && node.parentId === fromId) return true;
    if (node.id === fromId && node.parentId === toId) return true;
  }
  return false;
}

/**
 * Fades freshly placed highlight squares in (`square.last-move`, `square.check`, ...). Chessground
 * recycles square elements between positions, so a CSS keyframe would only run the first time; the
 * Web Animations API restarts it on the recycled node. Call after the board has redrawn.
 */
export function fadeInSquares(
  wrap: HTMLElement | null,
  selector: string,
  durationMs = HIGHLIGHT_FADE_MS,
  keyframes: Keyframe[] = FADE_IN
): void {
  if (!wrap || prefersReducedMotion()) return;
  for (const square of wrap.querySelectorAll<HTMLElement>(selector)) {
    if (square.style.visibility === "hidden") continue;
    // Restart our own fade only; CSS keyframes on the square (puzzle flashes) keep running.
    for (const animation of square.getAnimations()) if (!(animation instanceof CSSAnimation)) animation.cancel();
    square.animate(keyframes, { duration: durationMs, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
  }
}

const FADE_IN: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];


function expandBoard(fen: string): string {
  return (fen.split(" ")[0] ?? "").replace(/\d/g, (digits) => ".".repeat(Number(digits)));
}

/**
 * Whether two positions are one move apart as far as the eye can tell (at most four squares differ:
 * a move, a capture, en passant or castling). Used by boards that only receive a FEN.
 */
export function isOneMoveApart(fromFen: string, toFen: string): boolean {
  const from = expandBoard(fromFen);
  const to = expandBoard(toFen);
  if (!from || from.length !== to.length) return false;
  let differences = 0;
  for (let index = 0; index < from.length; index += 1) {
    if (from[index] !== to[index] && (differences += 1) > 4) return false;
  }
  return differences > 0;
}
