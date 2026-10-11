import { useCallback, useEffect, useRef } from "react";
import type confetti from "canvas-confetti";

/** The app's palette (app.css tokens), with their values for when a token can't be read. */
const PALETTE: ReadonlyArray<readonly [token: string, fallback: string]> = [
  ["--color-accent", "#8fb66f"],
  ["--color-warn", "#d8ad5a"],
  ["--color-piece-white", "#efe7d2"],
  ["--color-info", "#60a5fa"],
  ["--color-caution", "#f0a868"]
];

/** The confetti library, loaded on the first burst: a win or a solve is rare, startup is not. */
let confettiModule: Promise<typeof confetti> | null = null;
const loadConfetti = () =>
  (confettiModule ??= import("canvas-confetti").then((module) => module.default));

/**
 * A short confetti burst from the board, for a win or a solved puzzle. It draws on its own
 * full-window canvas (no pointer events, so nothing under it stops working), created on the first
 * burst and removed with the board. Nothing plays for users who prefer reduced motion.
 */
export function useBoardConfetti(): (board: HTMLElement | null, size: "game" | "puzzle") => void {
  const instance = useRef<{ fire: confetti.CreateTypes; canvas: HTMLCanvasElement } | null>(null);
  // Set on unmount: a burst whose library arrives after the board is gone draws nothing.
  const disposed = useRef(false);

  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
      instance.current?.fire.reset();
      instance.current?.canvas.remove();
      instance.current = null;
    };
  }, []);

  return useCallback((board, size) => {
    if (!board) return;
    const rect = board.getBoundingClientRect();
    if (!rect.width || !window.innerWidth || !window.innerHeight) return;
    const styles = getComputedStyle(document.documentElement);
    const colors = PALETTE.map(
      ([token, fallback]) => styles.getPropertyValue(token).trim() || fallback
    );
    const burst = {
      particleCount: size === "puzzle" ? 60 : 110,
      spread: size === "puzzle" ? 60 : 75,
      startVelocity: Math.min(48, Math.max(24, rect.width / 15)),
      gravity: 1.1,
      ticks: 220,
      scalar: 0.9,
      colors,
      // From the board's centre, a little below it, so the pieces rise over the board and fall
      // past it. A bigger board gets a stronger throw so the burst stays in proportion.
      origin: {
        x: (rect.left + rect.width / 2) / window.innerWidth,
        y: (rect.top + rect.height * 0.6) / window.innerHeight
      },
      disableForReducedMotion: true
    };
    loadConfetti()
      .then((library) => {
        if (disposed.current) return;
        instance.current ??= createInstance(library);
        void instance.current.fire(burst);
      })
      // A celebration that can't load is skipped: the game or puzzle goes on as it is.
      .catch(() => undefined);
  }, []);
}

/** Confetti's own full-window canvas, over the app without catching pointer events. */
function createInstance(library: typeof confetti) {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: "60"
  });
  document.body.appendChild(canvas);
  return { canvas, fire: library.create(canvas, { resize: true, disableForReducedMotion: true }) };
}
