import type { SoundSet } from "@chaturanga/shared/types/settings";
import { isBoardSound, moveSoundChain, type SoundFiles, type SoundKind } from "./sound-events";

/** Each set's recordings, loaded when it is chosen: only that set's files are ever fetched. */
const SET_FILES: Record<SoundSet, () => Promise<{ files: SoundFiles }>> = {
  sfx: () => import("./sets/sfx"),
  piano: () => import("./sets/piano"),
  nes: () => import("./sets/nes"),
  futuristic: () => import("./sets/futuristic"),
  pychess: () => import("./sets/pychess")
};

export type SoundPreferences = {
  enabled: boolean;
  /** 0–1. */
  volume: number;
  set: SoundSet;
  /** A check plays the sound of the move that gave it (see moveSoundChain). */
  silentCheck: boolean;
};

/** Two board sounds closer than this (a premove and the reply landing together): the later wins. */
export const STACK_MS = 60;
/** An announcement (a result, a game start, a solved puzzle) starts this long after a board sound. */
export const AFTER_MOVE_MS = 250;
/** The preview's sounds play this far apart. */
const PREVIEW_GAP_MS = 700;
/** Elements per file: enough for the overlaps a fast game makes, reused after that. */
const POOL_SIZE = 3;

/** Set by the app (useMoveSounds) from Settings; nothing plays until sounds are switched on. */
let preferences: SoundPreferences = { enabled: false, volume: 0.7, set: "sfx", silentCheck: false };
/** The chosen set's recordings, once loaded (until then nothing plays). */
let current: { set: SoundSet; files: SoundFiles } | null = null;
const loading = new Map<SoundSet, Promise<SoundFiles>>();
const pools = new Map<string, HTMLAudioElement[]>();
/** The latest board sound, which a sound stacked on it replaces and an announcement waits for. */
let lastBoard: { audio: HTMLAudioElement | null; at: number } | null = null;
const queued = new Set<ReturnType<typeof setTimeout>>();
const preview = new Set<ReturnType<typeof setTimeout>>();
let previewRun = 0;

function loadSet(set: SoundSet): Promise<SoundFiles> {
  const loaded = loading.get(set);
  if (loaded) return loaded;
  const pending = SET_FILES[set]().then((module) => module.files);
  loading.set(set, pending);
  // A set that failed to load is tried again the next time it's asked for.
  pending.catch(() => loading.delete(set));
  return pending;
}

/**
 * Applies the sound settings: loads the chosen set (and its files, so the first move doesn't wait
 * for one), and drops the elements of the set it replaces. Settles once the set is ready (a set
 * that can't load is logged: the board stays silent).
 */
export function configureSounds(next: SoundPreferences): Promise<void> {
  preferences = next;
  if (!next.enabled) {
    clearTimers(queued);
    return Promise.resolve();
  }
  if (current?.set === next.set) return Promise.resolve();
  return loadSet(next.set).then(
    (files) => {
      if (preferences.set !== next.set || current?.set === next.set) return;
      releaseElements();
      current = { set: next.set, files };
      preloadFiles(files);
    },
    (error: unknown) => console.debug(`[sounds] the ${next.set} set didn't load:`, error)
  );
}

/** Plays `kind` from the chosen set, if sounds are on and the set has it. */
export function playSound(kind: SoundKind): void {
  if (!preferences.enabled || !current) return;
  playFrom(current.files, kind);
}

/** Plays a move's sound (from its SAN): a check, castling, a capture or a move, as the set has. */
export function playMoveSound(san: string): void {
  if (!preferences.enabled || !current) return;
  const files = current.files;
  const kind = moveSoundChain(san, preferences.silentCheck).find((each) => files[each]);
  if (kind) playFrom(files, kind);
}

/**
 * Settings' preview of a set: a move, a capture, a check (unless checks are silent) and a win, one
 * after another. A second preview replaces the first. Settles once the sounds are scheduled.
 */
export function previewSoundSet(
  set: SoundSet,
  volume: number,
  silentCheck: boolean
): Promise<void> {
  clearTimers(preview);
  const run = ++previewRun;
  const kinds: SoundKind[] = [
    "move",
    "capture",
    ...(silentCheck ? [] : ["check" as const]),
    "victory"
  ];
  return loadSet(set).then(
    (files) => {
      // Clicked again while the set loaded: that preview plays instead.
      if (run !== previewRun) return;
      kinds.forEach((kind, index) => {
        const timer = setTimeout(() => {
          preview.delete(timer);
          const src = files[kind];
          if (src) start(src, volume, kind);
        }, index * PREVIEW_GAP_MS);
        preview.add(timer);
      });
    },
    (error: unknown) => console.debug(`[sounds] the ${set} set didn't load:`, error)
  );
}

function playFrom(files: SoundFiles, kind: SoundKind): void {
  const src = files[kind];
  if (!src) return;
  const now = performance.now();
  if (isBoardSound(kind)) {
    if (lastBoard && now - lastBoard.at < STACK_MS) lastBoard.audio?.pause();
    lastBoard = { audio: start(src, preferences.volume, kind), at: now };
    return;
  }
  // After the move that brought it (a mate, the solving move), not over it.
  const wait = lastBoard ? lastBoard.at + AFTER_MOVE_MS - now : 0;
  if (wait <= 0) {
    start(src, preferences.volume, kind);
    return;
  }
  const timer = setTimeout(() => {
    queued.delete(timer);
    if (preferences.enabled) start(src, preferences.volume, kind);
  }, wait);
  queued.add(timer);
}

/** Starts `src` at `volume` (0–1). Best-effort: a sound that cannot play is skipped. */
function start(src: string, volume: number, kind: SoundKind): HTMLAudioElement | null {
  try {
    const audio = elementFor(src);
    audio.volume = Math.max(0, Math.min(1, volume));
    audio.play().catch((error: unknown) => {
      console.debug(`[sounds] ${kind} didn't play:`, error);
    });
    return audio;
  } catch {
    return null; // Audio unavailable (e.g. no output device); sounds are optional.
  }
}

/** An idle element for `src` (rewound), a new one while the pool has room, else the oldest. */
function elementFor(src: string): HTMLAudioElement {
  const pool = pools.get(src) ?? [];
  pools.set(src, pool);
  const idle = pool.find((audio) => audio.paused || audio.ended);
  if (idle) {
    idle.currentTime = 0;
    return idle;
  }
  if (pool.length < POOL_SIZE) {
    const audio = new Audio(src);
    audio.preload = "auto";
    pool.push(audio);
    return audio;
  }
  const [oldest, ...rest] = pool;
  pools.set(src, [...rest, oldest]);
  oldest.pause();
  oldest.currentTime = 0;
  return oldest;
}

function preloadFiles(files: SoundFiles): void {
  try {
    for (const src of new Set(Object.values(files))) {
      if (!pools.has(src)) elementFor(src).load();
    }
  } catch {
    // No media elements here (tests, no audio): sounds are optional.
  }
}

function releaseElements(): void {
  for (const pool of pools.values()) for (const audio of pool) audio.pause();
  pools.clear();
  lastBoard = null;
}

function clearTimers(timers: Set<ReturnType<typeof setTimeout>>): void {
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
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
 * the window goes to the background it's suspended, and coming back resumes it. Returns the
 * cleanup.
 */
export function keepAudioAwake(
  environment: KeepAwakeEnvironment = browserEnvironment()
): () => void {
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
  let closed = false;
  // A suspend or resume in flight: the window may come back (or leave) before it settles, so the
  // state is checked again once it has.
  let transition: Promise<void> | null = null;
  const settle = (change: Promise<void>) => {
    transition = change
      .catch(() => undefined)
      .finally(() => {
        transition = null;
        if (!closed) update();
      });
  };
  const update = () => {
    if (transition) return;
    if (environment.isForeground()) {
      clearIdle();
      if (context.state === "suspended") settle(context.resume());
    } else if (idleTimer === null && context.state === "running") {
      idleTimer = environment.setTimeout(() => {
        idleTimer = null;
        if (!environment.isForeground() && context.state === "running") settle(context.suspend());
      }, AUDIO_IDLE_SUSPEND_MS);
    }
  };
  update();
  environment.target.addEventListener("focus", update);
  environment.target.addEventListener("blur", update);
  environment.documentTarget.addEventListener("visibilitychange", update);
  return () => {
    closed = true;
    clearIdle();
    environment.target.removeEventListener("focus", update);
    environment.target.removeEventListener("blur", update);
    environment.documentTarget.removeEventListener("visibilitychange", update);
    void context.close().catch(() => undefined);
  };
}
