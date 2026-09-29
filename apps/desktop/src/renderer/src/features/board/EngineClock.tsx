import { memo, useEffect, useState } from "react";
import type { Color } from "@chaturanga/shared/types/chess";
import { formatMillisecondsClock } from "@chaturanga/shared/chess/clock-display";
import { clockNow, remainingClockMs, useGameStore } from "../../stores/game-store";
import { ClockFace } from "./PlayerIdentity";

/** Under this much time the clock turns red, shows tenths and pulses while it runs. */
export const LOW_TIME_MS = 20_000;
const TENTHS_BELOW_MS = 10_000;

/** `M:SS`, or `S.t` tenths in the last ten seconds (rounded up, like the flag check). */
export function formatLiveClock(ms: number): string {
  const tenths = Math.ceil(ms / 100);
  if (ms > 0 && tenths < TENTHS_BELOW_MS / 100) return `0:0${Math.floor(tenths / 10)}.${tenths % 10}`;
  return formatMillisecondsClock(ms);
}

/** Milliseconds until the displayed text next changes (a second or tenth boundary). */
export function msUntilNextChange(ms: number): number {
  if (ms <= 0) return 1000;
  const step = ms <= TENTHS_BELOW_MS ? 100 : 1000;
  return ms % step || step;
}

/**
 * One side's live engine-game clock. It owns its ticking — a timer aimed at the next moment the
 * text changes (every second, every tenth in the last ten seconds) — so the board and the rest of
 * the view never re-render for the clock.
 */
export const EngineClock = memo(function EngineClock({ color }: { color: Color }) {
  const live = useGameStore((state) => state.engineClockLive);
  const [now, setNow] = useState(() => clockNow());
  const running = Boolean(live && live.sideToMove === color && live.stoppedAt === undefined);

  useEffect(() => {
    if (!running || !live) return;
    let timer = 0;
    const tick = () => {
      const at = clockNow();
      setNow(at);
      timer = window.setTimeout(tick, msUntilNextChange(remainingClockMs(live, color, at)) + 4);
    };
    timer = window.setTimeout(tick, 0);
    return () => window.clearTimeout(timer);
  }, [color, live, running]);

  if (!live) return null;
  // A finished game shows the exact time left when it ended (not the last tick).
  const remaining = remainingClockMs(live, color, live.stoppedAt ?? now);
  const low = remaining < LOW_TIME_MS;
  return (
    <ClockFace
      color={color}
      text={formatLiveClock(remaining)}
      active={running}
      low={low}
      running={running}
    />
  );
});
