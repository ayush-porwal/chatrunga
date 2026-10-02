import { describe, expect, it } from "vitest";
import { SESSION_IDLE_MS, SESSION_MAX_MS, TelemetrySession, uuidv7 } from "./session";

const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const T0 = Date.UTC(2026, 9, 2, 9, 30);

describe("uuidv7", () => {
  it("is a version 7 UUID that starts with its millisecond timestamp", () => {
    const id = uuidv7(T0);
    expect(id).toMatch(V7);
    expect(parseInt(id.replace(/-/g, "").slice(0, 12), 16)).toBe(T0);
    expect(uuidv7(T0)).not.toBe(id);
  });
});

describe("TelemetrySession", () => {
  it("keeps one id while events keep coming, and starts a new one after inactivity", () => {
    const session = new TelemetrySession();
    const first = session.current(T0);
    expect(session.current(T0 + SESSION_IDLE_MS - 1)).toBe(first);
    const second = session.current(T0 + 2 * SESSION_IDLE_MS);
    expect(second).not.toBe(first);
    expect(second).toMatch(V7);
  });

  it("splits a session that reaches a day, and one whose clock went backwards", () => {
    const session = new TelemetrySession();
    const first = session.current(T0);
    let now = T0;
    while (now < T0 + SESSION_MAX_MS - 60_000) {
      now += 60_000;
      expect(session.current(now)).toBe(first);
    }
    const split = session.current(T0 + SESSION_MAX_MS);
    expect(split).not.toBe(first);
    expect(session.current(T0)).not.toBe(split);
  });
});
