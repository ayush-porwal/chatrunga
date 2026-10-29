import { describe, expect, it } from "vitest";
import { createScrollRestore } from "./hub-scroll";

/** A scroller whose position is clamped to its content's height, like the hub's page. */
function scroller(maxScroll: number) {
  let top = 0;
  return {
    maxScroll,
    get scrollTop() {
      return top;
    },
    set scrollTop(value: number) {
      top = Math.max(0, Math.min(value, this.maxScroll));
    }
  };
}

describe("restoring a hub tab's scroll position", () => {
  it("tries again as the content grows, never remembering the clamped positions met meanwhile", () => {
    const page = scroller(0);
    const restore = createScrollRestore(800);
    restore.restore(page);
    expect(page.scrollTop).toBe(0);
    // The clamped restore's own scroll event: not a position to remember.
    expect(restore.scrolled(page)).toBeNull();
    page.maxScroll = 300;
    restore.restore(page);
    expect(page.scrollTop).toBe(300);
    expect(restore.scrolled(page)).toBeNull();
    page.maxScroll = 2000;
    restore.restore(page);
    expect(page.scrollTop).toBe(800);
    // Reached: scrolling from here is remembered, and later resizes leave it alone.
    page.scrollTop = 900;
    expect(restore.scrolled(page)).toBe(900);
    restore.restore(page);
    expect(page.scrollTop).toBe(900);
  });

  it("stops restoring once the user scrolls", () => {
    const page = scroller(100);
    const restore = createScrollRestore(800);
    restore.restore(page);
    page.scrollTop = 40;
    expect(restore.scrolled(page)).toBe(40);
    page.maxScroll = 2000;
    restore.restore(page);
    expect(page.scrollTop).toBe(40);
  });
});
