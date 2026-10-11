import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AFTER_MOVE_MS,
  AUDIO_IDLE_SUSPEND_MS,
  configureSounds,
  keepAudioAwake,
  LATE_MS,
  playMoveSound,
  playSound,
  previewSoundSet,
  STACK_MS,
  type SoundPreferences
} from "./sounds";

/** What the player did with its elements, as "<action> <set>/<file>". */
const log: string[] = [];
const named = (src: string) => src.split("/").slice(-2).join("/");

/** A media element that plays at once (none in Node). */
class FakeAudio {
  paused = true;
  ended = false;
  currentTime = 0;
  volume = 1;
  preload = "";
  constructor(readonly src: string) {}
  load(): void {}
  play(): Promise<void> {
    this.paused = false;
    log.push(`play ${named(this.src)}`);
    return Promise.resolve();
  }
  pause(): void {
    if (!this.paused) log.push(`stop ${named(this.src)}`);
    this.paused = true;
  }
}

const sfx: SoundPreferences = { enabled: true, volume: 0.5, set: "sfx", silentCheck: false };

describe("the sound player", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    vi.stubGlobal("Audio", FakeAudio);
    // Another set first: a set changed starts afresh (no earlier sound to stack on or wait for).
    await configureSounds({ ...sfx, set: "futuristic" });
    await configureSounds(sfx);
    log.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each([
    ["Nf3", "play sfx/Move.mp3"],
    ["exd5", "play sfx/Capture.mp3"],
    ["Qxe2+", "play sfx/Check.mp3"],
    ["Qh4#", "play sfx/Check.mp3"],
    // Lichess's sets have no castling sound: castling is a move.
    ["O-O", "play sfx/Move.mp3"]
  ])("%s plays %s from the chosen set", (san, file) => {
    playMoveSound(san);
    expect(log).toStrictEqual([file]);
  });

  it("with silent checks, a capturing check plays the capture", async () => {
    await configureSounds({ ...sfx, silentCheck: true });
    playMoveSound("Qxe2+");
    expect(log).toStrictEqual(["play sfx/Capture.mp3"]);
  });

  it("PyChess has its own castling and refused-move sounds", async () => {
    await configureSounds({ ...sfx, set: "pychess" });
    playMoveSound("O-O-O");
    vi.advanceTimersByTime(STACK_MS);
    playSound("error");
    expect(log).toStrictEqual(["play pychess/castle.mp3", "play pychess/invalid.mp3"]);
  });

  it("a sound the set doesn't have plays nothing", () => {
    playSound("error");
    expect(log).toStrictEqual([]);
  });

  it("with sounds off, nothing plays", async () => {
    await configureSounds({ ...sfx, enabled: false });
    playMoveSound("Nf3");
    playSound("victory");
    expect(log).toStrictEqual([]);
  });

  it("a move sound stacked on another (a premove and its reply) replaces it", () => {
    playMoveSound("e4");
    vi.advanceTimersByTime(STACK_MS - 10);
    playMoveSound("exd5");
    expect(log).toStrictEqual(["play sfx/Move.mp3", "stop sfx/Move.mp3", "play sfx/Capture.mp3"]);
  });

  it("a result waits for the mating move's sound to start first", () => {
    playMoveSound("Qh4#");
    playSound("defeat");
    expect(log).toStrictEqual(["play sfx/Check.mp3"]);
    vi.advanceTimersByTime(AFTER_MOVE_MS);
    expect(log).toStrictEqual(["play sfx/Check.mp3", "play sfx/Defeat.mp3"]);
  });

  it("a move made while a new set loads plays from that set once it arrives, never the old one", async () => {
    const loaded = configureSounds({ ...sfx, set: "piano" });
    playMoveSound("Nf3");
    expect(log).toStrictEqual([]);
    await loaded;
    expect(log).toStrictEqual(["play piano/Move.mp3"]);
  });

  it("a move older than LATE_MS when its set arrives stays silent", async () => {
    const loaded = configureSounds({ ...sfx, set: "nes" });
    playMoveSound("Nf3");
    vi.advanceTimersByTime(LATE_MS + 1);
    await loaded;
    expect(log).toStrictEqual([]);
  });

  it("a result still waiting when the set changes doesn't play", async () => {
    playMoveSound("Qh4#");
    playSound("defeat");
    await configureSounds({ ...sfx, set: "nes" });
    vi.advanceTimersByTime(AFTER_MOVE_MS);
    expect(log).toStrictEqual(["play sfx/Check.mp3", "stop sfx/Check.mp3"]);
  });

  it("switching sounds off stops a preview, playing or still loading", async () => {
    await previewSoundSet("piano", 0.5, false);
    vi.advanceTimersByTime(0);
    await configureSounds({ ...sfx, enabled: false });
    vi.advanceTimersByTime(5_000);
    expect(log).toStrictEqual(["play piano/Move.mp3"]);

    await configureSounds(sfx);
    const loading = previewSoundSet("futuristic", 0.5, false);
    await configureSounds({ ...sfx, enabled: false });
    await loading;
    vi.advanceTimersByTime(5_000);
    expect(log).toStrictEqual(["play piano/Move.mp3"]);
  });

  it("each result has its own recording", () => {
    playSound("victory");
    playSound("defeat");
    playSound("draw");
    expect(log).toStrictEqual(["play sfx/Victory.mp3", "play sfx/Defeat.mp3", "play sfx/Draw.mp3"]);
  });

  it("the preview plays a move, a capture, a check and a win, one after another", async () => {
    await previewSoundSet("piano", 0.5, false);
    vi.advanceTimersByTime(5_000);
    expect(log).toStrictEqual([
      "play piano/Move.mp3",
      "play piano/Capture.mp3",
      "play piano/Check.mp3",
      "play piano/Victory.mp3"
    ]);
  });

  it("the preview leaves the check out when checks are silent", async () => {
    await previewSoundSet("nes", 0.5, true);
    vi.advanceTimersByTime(5_000);
    expect(log).toStrictEqual([
      "play nes/Move.mp3",
      "play nes/Capture.mp3",
      "play nes/Victory.mp3"
    ]);
  });
});

function fakeEnvironment() {
  let foreground = true;
  const listeners = new Map<string, () => void>();
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const context = {
    state: "running" as AudioContextState,
    destination: {},
    createGain: () => ({ gain: { value: 1 }, connect: (next: unknown) => next }),
    createConstantSource: () => ({ connect: (next: unknown) => next, start: vi.fn() }),
    suspend: vi.fn(async () => void (context.state = "suspended")),
    resume: vi.fn(async () => void (context.state = "running")),
    close: vi.fn(async () => void (context.state = "closed"))
  };
  const on = {
    addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type)
  };
  return {
    context,
    listeners,
    timers,
    setForeground: (value: boolean, event: string) => {
      foreground = value;
      listeners.get(event)?.();
    },
    runTimers: () => [...timers.entries()].forEach(([id, fn]) => (timers.delete(id), fn())),
    environment: {
      createContext: () => context as unknown as AudioContext,
      isForeground: () => foreground,
      target: on as unknown as Window,
      documentTarget: on as unknown as Document,
      setTimeout: (fn: () => void, ms: number) => {
        expect(ms).toBe(AUDIO_IDLE_SUSPEND_MS);
        timers.set(nextTimer, fn);
        return nextTimer++;
      },
      clearTimeout: (id: number) => void timers.delete(id)
    }
  };
}

describe("keepAudioAwake", () => {
  it("keeps the output running in front, suspends a minute after leaving, resumes on return", async () => {
    const fake = fakeEnvironment();
    const stop = keepAudioAwake(fake.environment);
    expect(fake.timers.size).toBe(0);

    fake.setForeground(false, "blur");
    expect(fake.timers.size).toBe(1);
    // Back before the minute is up: nothing is suspended.
    fake.setForeground(true, "focus");
    expect(fake.timers.size).toBe(0);
    expect(fake.context.suspend).not.toHaveBeenCalled();

    fake.setForeground(false, "visibilitychange");
    fake.runTimers();
    expect(fake.context.suspend).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    fake.setForeground(true, "focus");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.context.resume).toHaveBeenCalledTimes(1);

    stop();
    expect(fake.context.close).toHaveBeenCalledWith();
    expect(fake.listeners.size).toBe(0);
  });

  it("coming back while the output is still suspending resumes it once that settles", async () => {
    const fake = fakeEnvironment();
    let finishSuspend: () => void = () => undefined;
    fake.context.suspend.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          finishSuspend = () => {
            fake.context.state = "suspended";
            resolve(undefined);
          };
        })
    );
    const stop = keepAudioAwake(fake.environment);
    fake.setForeground(false, "blur");
    fake.runTimers();
    expect(fake.context.suspend).toHaveBeenCalledTimes(1);
    // Back in front before the suspension finished: still "running", nothing to resume yet.
    fake.setForeground(true, "focus");
    expect(fake.context.resume).not.toHaveBeenCalled();
    finishSuspend();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.context.resume).toHaveBeenCalledTimes(1);
    stop();
  });

  it("without Web Audio it does nothing (sounds still play)", () => {
    const fake = fakeEnvironment();
    const stop = keepAudioAwake({
      ...fake.environment,
      createContext: () => {
        throw new Error("no audio");
      }
    });
    expect(fake.listeners.size).toBe(0);
    stop();
  });
});
