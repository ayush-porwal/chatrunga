import moveUrl from "../assets/sounds/Move.mp3";
import captureUrl from "../assets/sounds/Capture.mp3";
import victoryUrl from "../assets/sounds/Victory.mp3";
import defeatUrl from "../assets/sounds/Defeat.mp3";
import drawUrl from "../assets/sounds/Draw.mp3";

const sources = {
  move: moveUrl,
  capture: captureUrl,
  check: moveUrl,
  victory: victoryUrl,
  defeat: defeatUrl,
  draw: drawUrl
} as const;

export type SoundKind = keyof typeof sources;

let preloaded = false;

/** Warms the browser cache so the first move sound plays without a delay. */
function preload(): void {
  if (preloaded) return;
  preloaded = true;
  for (const src of new Set(Object.values(sources))) {
    const audio = new Audio(src);
    audio.preload = "auto";
    audio.load();
  }
}

/** Plays a sound at `volume` (0–1). Best-effort: a sound that cannot play is skipped silently. */
export function playSound(kind: SoundKind, volume: number): void {
  preload();
  try {
    const audio = new Audio(sources[kind]);
    audio.volume = Math.max(0, Math.min(1, volume));
    audio.play().catch(() => undefined);
  } catch {
    // Audio unavailable (e.g. no output device); sounds are optional.
  }
}
