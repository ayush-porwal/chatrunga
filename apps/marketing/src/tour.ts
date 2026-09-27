/**
 * The review tour: on wide screens a sticky stage shows the app screen for the chapter being read,
 * and the frosted segmented control above it tracks (and jumps between) chapters. Narrow screens
 * show each chapter's own screenshot inline instead, so none of this runs there.
 */

const WIDE = "(min-width: 1100px)";

export function initTour(root: Document = document): void {
  const stage = root.querySelector<HTMLElement>("[data-stage]");
  const indicator = root.querySelector<HTMLElement>("[data-indicator]");
  const chapters = [...root.querySelectorAll<HTMLElement>("[data-chapter]")];
  if (!stage || !indicator || chapters.length === 0) return;

  const shots = [...stage.querySelectorAll<HTMLElement>("[data-shot]")];
  const links = [...stage.querySelectorAll<HTMLAnchorElement>("[data-chapter-link]")];
  let active = "";

  function moveIndicator(animate: boolean): void {
    const link = links.find((l) => l.dataset.chapterLink === active);
    if (!link || link.offsetWidth === 0) return;
    // Same as the app's SegmentedControl: one pill slides (transform + width, spring easing).
    const snap = !animate || indicator!.style.opacity !== "1";
    if (snap) indicator!.style.transition = "none";
    indicator!.style.transform = `translateX(${link.offsetLeft}px)`;
    indicator!.style.width = `${link.offsetWidth}px`;
    indicator!.style.opacity = "1";
    if (snap) {
      void indicator!.offsetWidth;
      indicator!.style.transition = "";
    }
  }

  function activate(id: string): void {
    if (id === active) return;
    active = id;
    for (const shot of shots) {
      const on = shot.dataset.shot === id;
      shot.classList.toggle("is-active", on);
      // Only the visible screen is exposed to assistive tech.
      shot.setAttribute("aria-hidden", String(!on));
    }
    for (const link of links) {
      if (link.dataset.chapterLink === id) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    }
    moveIndicator(true);
  }

  // A chapter is current once it crosses the middle of the viewport.
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) activate((entry.target as HTMLElement).dataset.chapter ?? "");
      }
    },
    { rootMargin: "-50% 0px -50% 0px" }
  );

  const wide = window.matchMedia(WIDE);
  function sync(): void {
    if (wide.matches) {
      for (const chapter of chapters) observer.observe(chapter);
      if (!active) activate(chapters[0].dataset.chapter ?? "");
      moveIndicator(false);
    } else {
      observer.disconnect();
    }
  }
  wide.addEventListener("change", sync);
  window.addEventListener("resize", () => moveIndicator(false));
  sync();
}
