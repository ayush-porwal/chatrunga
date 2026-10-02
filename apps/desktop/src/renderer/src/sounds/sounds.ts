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

/** One loaded element per file, reused while it isn't playing (a new one only for overlaps). */
const elements = new Map<string, HTMLAudioElement>();

function elementFor(src: string): HTMLAudioElement {
  const loaded = elements.get(src);
  if (loaded && (loaded.paused || loaded.ended)) {
    loaded.currentTime = 0;
    return loaded;
  }
  const audio = new Audio(src);
  audio.preload = "auto";
  if (!loaded) {
    audio.load();
    elements.set(src, audio);
  }
  return audio;
}

/** Loads every sound file now, so the first move doesn't wait for one. */
function preload(): void {
  try {
    for (const src of new Set(Object.values(sources))) {
      if (!elements.has(src)) elementFor(src);
    }
  } catch {
    // No media elements here (tests, no audio): sounds are optional.
  }
}

/** Plays a sound at `volume` (0–1). Best-effort: a sound that cannot play is skipped silently. */
export function playSound(kind: SoundKind, volume: number): void {
  try {
    const audio = elementFor(sources[kind]);
    audio.volume = Math.max(0, Math.min(1, volume));
    audio.play().catch((error: unknown) => {
      console.debug(`[sounds] ${kind} didn't play:`, error);
    });
  } catch {
    // Audio unavailable (e.g. no output device); sounds are optional.
  }
}

/** Keep the output awake this long after the window goes to the background. */
export const AUDIO_IDLE_SUSPEND_MS = 60_000;

type KeepAwakeEnvironment = {
  createContext: () => AudioContext;
  isForeground: () => boolean;
  target: Pick<Window, "addEventListener" | "removeEventListener">;
  documentTarget: Pick<Document, "addEventListener" | "removeEventListener">;
  setTimeout: (callback: () => void, ms: number) => number;
  clearTimeout: (handle: number) => void;
};

const browserEnvironment = (): KeepAwakeEnvironment => ({
  createContext: () => new AudioContext({ latencyHint: "interactive" }),
  isForeground: () => document.visibilityState === "visible" && document.hasFocus(),
  target: window,
  documentTarget: document,
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => window.clearTimeout(handle)
});

/**
 * Keeps the audio output running while the app is in use, so the first move sound isn't lost.
 * The sounds themselves play from the start (measured), but an output that has gone idle —
 * Bluetooth headphones especially — takes a moment to wake, and a 0.1 s move sound is over by
 * then. A silent Web Audio stream holds it awake while the window is in front; a minute after
 * the window goes to the background it's suspended, and coming back resumes it. Also loads every
 * sound. Returns the cleanup.
 */
export function keepAudioAwake(
  environment: KeepAwakeEnvironment = browserEnvironment()
): () => void {
  preload();
  let context: AudioContext;
  try {
    context = environment.createContext();
    const silence = context.createGain();
    silence.gain.value = 0;
    const source = context.createConstantSource();
    source.connect(silence).connect(context.destination);
    source.start();
  } catch {
    return () => undefined; // No Web Audio: sounds still play, just without the warm output.
  }
  let idleTimer: number | null = null;
  const clearIdle = () => {
    if (idleTimer !== null) environment.clearTimeout(idleTimer);
    idleTimer = null;
  };
  const update = () => {
    if (environment.isForeground()) {
      clearIdle();
      if (context.state === "suspended") void context.resume().catch(() => undefined);
    } else if (idleTimer === null && context.state === "running") {
      idleTimer = environment.setTimeout(() => {
        idleTimer = null;
        void context.suspend().catch(() => undefined);
      }, AUDIO_IDLE_SUSPEND_MS);
    }
  };
  update();
  environment.target.addEventListener("focus", update);
  environment.target.addEventListener("blur", update);
  environment.documentTarget.addEventListener("visibilitychange", update);
  return () => {
    clearIdle();
    environment.target.removeEventListener("focus", update);
    environment.target.removeEventListener("blur", update);
    environment.documentTarget.removeEventListener("visibilitychange", update);
    void context.close().catch(() => undefined);
  };
}
