import { describe, expect, it } from "vitest";
import {
  formatClockForDisplay,
  formatMillisecondsClock,
  formatMillisecondsDuration
} from "./clock-display";

describe("formatClockForDisplay", () => {
  it("uses MM:SS when hours are zero", () => {
    expect(formatClockForDisplay("0:03:00")).toBe("03:00");
    expect(formatClockForDisplay("0:00:05")).toBe("00:05");
  });

  it("keeps a short fraction on seconds when present", () => {
    expect(formatClockForDisplay("0:02:58.246")).toBe("02:58.246");
    expect(formatClockForDisplay("0:01:45.741")).toBe("01:45.741");
  });

  it("drops a zero fractional part", () => {
    expect(formatClockForDisplay("0:10:00.0")).toBe("10:00");
  });

  it("uses H:MM:SS when hours are non-zero", () => {
    expect(formatClockForDisplay("1:02:03")).toBe("1:02:03");
    expect(formatClockForDisplay("10:15:30")).toBe("10:15:30");
  });

  it("passes through unknown strings", () => {
    expect(formatClockForDisplay("—")).toBe("—");
    expect(formatClockForDisplay("n/a")).toBe("n/a");
  });
});

describe("formatMillisecondsClock", () => {
  it("formats under one hour", () => {
    expect(formatMillisecondsClock(65_000)).toBe("1:05");
    expect(formatMillisecondsClock(0)).toBe("0:00");
  });

  it("formats with hours", () => {
    expect(formatMillisecondsClock(3_600_000)).toBe("1:00:00");
  });
});

describe("formatMillisecondsDuration", () => {
  it("rounds to the nearest second, unlike the countdown clock", () => {
    expect(formatMillisecondsDuration(7_300)).toBe("0:07");
    expect(formatMillisecondsClock(7_300)).toBe("0:08");
    expect(formatMillisecondsDuration(7_500)).toBe("0:08");
    expect(formatMillisecondsDuration(400)).toBe("0:00");
    expect(formatMillisecondsDuration(3_599_600)).toBe("1:00:00");
  });
});
