import "./styles.css";
import "./pieces.css";
import { applyPlatform } from "./shared/platform";
import { initCoach } from "./coach";
import { initTour } from "./tour";

applyPlatform();
initCoach();
initTour();

/**
 * Hero depth: the backdrop and the floating panels drift at slightly different rates while the hero
 * is on screen. Uses the `translate` property so it never fights the entrance animation's
 * `transform`. Off for reduced motion and on narrow screens, where the panels simply stack.
 */
function initDepth(): void {
  const motion = window.matchMedia(
    "(prefers-reduced-motion: no-preference) and (min-width: 768px)"
  );
  const hero = document.querySelector<HTMLElement>(".hero");
  const layers = [...document.querySelectorAll<HTMLElement>(".hero [data-depth]")];
  if (!hero || layers.length === 0) return;

  let queued = false;
  function update(): void {
    queued = false;
    const y = Math.min(window.scrollY, hero!.offsetHeight);
    for (const layer of layers) {
      layer.style.translate = motion.matches
        ? `0 ${(y * Number(layer.dataset.depth)).toFixed(1)}px`
        : "";
    }
  }
  function queue(): void {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  }
  window.addEventListener("scroll", queue, { passive: true });
  motion.addEventListener("change", queue);
  update();
}

initDepth();
