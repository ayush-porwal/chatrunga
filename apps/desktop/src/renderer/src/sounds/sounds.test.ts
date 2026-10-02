import { describe, expect, it, vi } from "vitest";
import { AUDIO_IDLE_SUSPEND_MS, keepAudioAwake } from "./sounds";

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
  const on = { addEventListener: (type: string, fn: () => void) => listeners.set(type, fn), removeEventListener: (type: string) => listeners.delete(type) };
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
    await Promise.resolve();
    fake.setForeground(true, "focus");
    expect(fake.context.resume).toHaveBeenCalledTimes(1);

    stop();
    expect(fake.context.close).toHaveBeenCalled();
    expect(fake.listeners.size).toBe(0);
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
