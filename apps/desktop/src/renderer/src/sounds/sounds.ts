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

function preload(): void {
  if (preloaded) return;
  preloaded = true;
  for (const src of Object.values(sources)) {
    const audio = new Audio(src);
    audio.preload = "auto";
    audio.load();
  }
}

export function playSound(kind: SoundKind, volume: number): void {
  preload();
  const normalizedVolume = Math.max(0, Math.min(1, volume));
  try {
    const audio = new Audio(sources[kind]);
    audio.volume = normalizedVolume;
    audio.addEventListener(
      "error",
      () => {
        console.warn(`[sounds] failed to load ${sources[kind]}`, audio.error);
      },
      { once: true }
    );
    void audio.play().catch((err) => {
      console.warn(`[sounds] play() rejected for ${kind}:`, err);
    });
  } catch (err) {
    console.warn(`[sounds] threw for ${kind}:`, err);
  }
}
