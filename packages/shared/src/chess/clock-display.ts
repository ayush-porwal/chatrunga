const THREE_PART = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/;

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Format the seconds segment (with optional fraction); trim useless decimals. */
function formatSecondsComponent(sec: number): string {
  const whole = Math.floor(sec + 1e-9);
  const frac = sec - whole;
  if (frac < 0.0005) return pad2(whole);
  const ms = Math.round(frac * 1000);
  const dec = ms.toString().padStart(3, "0").replace(/0+$/, "");
  return dec ? `${pad2(whole)}.${dec}` : pad2(whole);
}

/**
 * Pretty clock for the board: `MM:SS` or `MM:SS.d` under an hour; `H:MM:SS` when hours ≥ 1.
 * Unrecognized strings (e.g. placeholders) are returned unchanged.
 */
export function formatClockForDisplay(raw: string): string {
  const s = raw.trim();
  if (!s) return s;

  const m = THREE_PART.exec(s);
  if (!m) return raw;

  const hours = parseInt(m[1], 10);
  const minutes = parseInt(m[2], 10);
  const seconds = parseFloat(m[3]);
  if (Number.isNaN(seconds)) return raw;

  const secPart = formatSecondsComponent(seconds);

  if (hours > 0) return `${hours}:${pad2(minutes)}:${secPart}`;
  return `${pad2(minutes)}:${secPart}`;
}

/**
 * Live countdown for timed engine games (`M:SS` or `H:MM:SS`).
 */
export function formatMillisecondsClock(ms: number): string {
  const secondsTotal = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(secondsTotal / 3600);
  const minutes = Math.floor((secondsTotal % 3600) / 60);
  const sec = secondsTotal % 60;
  if (hours > 0) return `${hours}:${pad2(minutes)}:${pad2(sec)}`;
  return `${minutes}:${pad2(sec)}`;
}
