import { useCallback, useEffect, useRef } from "react";
import confetti from "canvas-confetti";

/** The app's palette (app.css tokens), with their values for when a token can't be read. */
const PALETTE: ReadonlyArray<readonly [token: string, fallback: string]> = [
  ["--color-accent", "#8fb66f"],
  ["--color-warn", "#d8ad5a"],
  ["--color-piece-white", "#efe7d2"],
  ["--color-info", "#60a5fa"],
  ["--color-caution", "#f0a868"]
];

/**
 * A short confetti burst from the board, for a win or a solved puzzle. It draws on its own
 * full-window canvas (no pointer events, so nothing under it stops working), created on the first
 * burst and removed with the board. Nothing plays for users who prefer reduced motion.
 */
export function useBoardConfetti(): (board: HTMLElement | null, size: "game" | "puzzle") => void {
  const instance = useRef<{ fire: confetti.CreateTypes; canvas: HTMLCanvasElement } | null>(null);

  useEffect(
    () => () => {
      instance.current?.fire.reset();
      instance.current?.canvas.remove();
      instance.current = null;
    },
    []
  );

  return useCallback((board, size) => {
    if (!board) return;
    const rect = board.getBoundingClientRect();
    if (!rect.width || !window.innerWidth || !window.innerHeight) return;
    if (!instance.current) {
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
      instance.current = {
        canvas,
        fire: confetti.create(canvas, { resize: true, disableForReducedMotion: true })
      };
    }
    const styles = getComputedStyle(document.documentElement);
    const colors = PALETTE.map(
      ([token, fallback]) => styles.getPropertyValue(token).trim() || fallback
    );
    // From the board's centre, a little below it, so the pieces rise over the board and fall past it.
    // A bigger board gets a stronger throw so the burst stays in proportion.
    void instance.current.fire({
      particleCount: size === "puzzle" ? 60 : 110,
      spread: size === "puzzle" ? 60 : 75,
      startVelocity: Math.min(48, Math.max(24, rect.width / 15)),
      gravity: 1.1,
      ticks: 220,
      scalar: 0.9,
      colors,
      origin: {
        x: (rect.left + rect.width / 2) / window.innerWidth,
        y: (rect.top + rect.height * 0.6) / window.innerHeight
      },
      disableForReducedMotion: true
    });
  }, []);
}
