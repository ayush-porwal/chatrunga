import { useEffect, useState } from "react";

/**
 * Whether the window has been hidden (minimised, or behind a full-screen app) for longer than
 * `graceMs`: a quick switch away doesn't count. False again as soon as it shows.
 */
export function useLongHidden(graceMs: number): boolean {
  const [longHidden, setLongHidden] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const hideLater = () => {
      timer = setTimeout(() => setLongHidden(true), graceMs);
    };
    const onChange = () => {
      clearTimeout(timer);
      if (document.visibilityState === "hidden") hideLater();
      else setLongHidden(false);
    };
    if (document.visibilityState === "hidden") hideLater();
    document.addEventListener("visibilitychange", onChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onChange);
    };
  }, [graceMs]);
  return longHidden;
}
