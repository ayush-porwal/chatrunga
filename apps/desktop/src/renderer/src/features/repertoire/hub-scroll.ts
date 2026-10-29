/** What the scroll restore reads and sets: the scrolling element's position (clamped by it). */
type Scroller = { scrollTop: number };

/**
 * Puts a hub tab's saved scroll position back once its content is tall enough: a tab still loading
 * (its code, its queries) clamps the position, so each `restore` (on mount, then on every resize of
 * the content) tries again until it reaches the saved one. `scrolled` (a scroll event) is the
 * position to remember, or null for the clamped positions a restore left: those never replace the
 * saved one. Scrolling by the user ends the restore.
 */
export function createScrollRestore(saved: number) {
  let pending: number | null = saved;
  /** Where the last restore left the scroller (its scroll event isn't the user's). */
  let applied: number | null = null;
  return {
    restore(scroller: Scroller) {
      if (pending === null) return;
      scroller.scrollTop = pending;
      applied = scroller.scrollTop;
      if (applied >= pending - 1) pending = null;
    },
    scrolled(scroller: Scroller): number | null {
      if (pending !== null && applied !== null && Math.abs(scroller.scrollTop - applied) < 1) {
        return null;
      }
      pending = null;
      return scroller.scrollTop;
    }
  };
}
