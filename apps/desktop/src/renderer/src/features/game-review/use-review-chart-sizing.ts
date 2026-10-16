/**
 * The review charts' sizes (ReviewCharts.tsx): their width, the charts area's height and its
 * splitter, the views' share of it, and each chart's fold.
 */
import {
  useCallback,
  useId,
  useLayoutEffect,
  useState,
  type KeyboardEvent,
  type PointerEvent
} from "react";
import {
  loadChartCollapsed,
  loadChartsHeight,
  saveChartCollapsed,
  saveChartsHeight,
  type FoldableChart
} from "./review-chart-prefs";
import {
  CHARTS_MIN_HEIGHT,
  chartsMaxHeight,
  clampChartsHeight,
  fitViewHeights,
  openViews,
  resolveChartsHeight,
  SPLITTER_STEP,
  viewHeights,
  type ChartsLayout,
  type ViewHeights
} from "./review-chart-layout";

/** The element's laid-out width in CSS pixels (0 until measured), kept up to date. */
export function useWidth(): [
  (element: HTMLDivElement | null) => void,
  number,
  HTMLDivElement | null
] {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!element) return;
    setWidth(Math.round(element.getBoundingClientRect().width));
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, width, element];
}

type ViewsBox = { container: number; chrome: number[]; gap: number };

/**
 * The views area's height and its rows that aren't views (strip labels, notes, the move axis),
 * measured as laid out, so the views share exactly what is left (fitViewHeights). `layoutKey`
 * changes whenever those rows do; the area's own resizes are observed.
 */
function useViewsBox(element: HTMLElement | null, layoutKey: string): ViewsBox | null {
  const [box, setBox] = useState<ViewsBox | null>(null);
  useLayoutEffect(() => {
    if (!element) {
      setBox(null);
      return;
    }
    const update = () => {
      const style = getComputedStyle(element);
      const chrome: number[] = [];
      for (const child of element.children) {
        const childStyle = getComputedStyle(child);
        // Out of the grid's rows: hidden placeholders, the tooltip and screen-reader text.
        if (childStyle.display === "none" || childStyle.position === "absolute") continue;
        if (child.hasAttribute("data-chart")) continue;
        chrome.push(child.getBoundingClientRect().height);
      }
      const next = {
        container: element.clientHeight,
        chrome,
        gap: Number.parseFloat(style.rowGap) || 0
      };
      setBox((current) =>
        current &&
        current.container === next.container &&
        current.gap === next.gap &&
        current.chrome.join() === next.chrome.join()
          ? current
          : next
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, layoutKey]);
  return box;
}

/**
 * The open views' heights in the views area `element`: they share the height beyond the fixed rows
 * equally, each above its minimum, once the area is laid out (`measured`, its width known); until
 * then, their share of the charts' `height`.
 */
export function useViewHeights(
  element: HTMLElement | null,
  layout: ChartsLayout,
  height: number,
  measured: boolean
): ViewHeights {
  const box = useViewsBox(
    element,
    `${layout.win}|${layout.difficulty}|${layout.times}|${measured}`
  );
  return box ? fitViewHeights({ ...box, open: openViews(layout) }) : viewHeights(height, layout);
}

/** A chart's fold: folded or not (remembered: review-chart-prefs.ts), and the folded part's id. */
export type Fold = { collapsed: boolean; toggle: () => void; id: string };

export function useFold(chart: FoldableChart): Fold {
  const [collapsed, setCollapsed] = useState(() => loadChartCollapsed(chart));
  const toggle = useCallback(() => {
    setCollapsed((value) => {
      saveChartCollapsed(chart, !value);
      return !value;
    });
  }, [chart]);
  const id = useId();
  return { collapsed, toggle, id };
}

/** The panel content above the charts: the block before the panel footer holding them. */
function contentAbove(element: HTMLElement | null): HTMLElement | null {
  let footer = element;
  while (footer?.parentElement && footer.parentElement.tagName !== "ASIDE")
    footer = footer.parentElement;
  const above = footer?.parentElement ? footer.previousElementSibling : null;
  return above instanceof HTMLElement ? above : null;
}

type SplitterDrag = { pointerId: number; y: number; start: number };

/**
 * The charts area's height and its splitter: the height the user dragged it to (remembered), else
 * the default for the views shown, clamped so the charts keep their minimum and the content above
 * keeps its own (review-chart-layout.ts).
 */
export function useChartsHeight(layout: ChartsLayout, fill: boolean) {
  const [section, setSection] = useState<HTMLElement | null>(null);
  const [stored, setStored] = useState<number | null>(() => loadChartsHeight());
  const [max, setMax] = useState<number | null>(null);
  const [measured, setMeasured] = useState<number | null>(null);
  // The drag in progress (its pointer, where it started, and the height then).
  const [drag, setDrag] = useState<SplitterDrag | null>(null);
  const height = resolveChartsHeight({ fill, measured, stored, max, layout });

  // Filling, the charts take the height the panel gives them (flex), measured here.
  useLayoutEffect(() => {
    if (!section || !fill) return;
    const update = () => setMeasured(section.getBoundingClientRect().height);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(section);
    return () => observer.disconnect();
  }, [fill, section]);

  // The content and the charts trade height, so their sum (the room both share) sets the limit.
  useLayoutEffect(() => {
    const above = contentAbove(section);
    if (!section || !above || fill) return;
    // Only the part marked as yielding (the move list) gives up height; the rest of the content
    // (tabs, live strips, engine lines) keeps its own, or the charts would grow over it.
    let yields: Element | null = null;
    const update = () => {
      const content = above.getBoundingClientRect().height;
      const fixed = yields ? content - yields.getBoundingClientRect().height : 0;
      setMax(chartsMaxHeight(content, section.getBoundingClientRect().height, fixed));
    };
    const observer = new ResizeObserver(update);
    // The marked part comes and goes with the panel's tab: follow it.
    const follow = () => {
      const next = above.querySelector("[data-panel-yields]");
      if (next === yields) return;
      if (yields) observer.unobserve(yields);
      yields = next;
      if (yields) observer.observe(yields);
      update();
    };
    follow();
    update();
    observer.observe(above);
    observer.observe(section);
    const mutations = new MutationObserver(follow);
    mutations.observe(above, { childList: true, subtree: true });
    return () => {
      mutations.disconnect();
      observer.disconnect();
    };
  }, [fill, section]);

  const set = (next: number | null, save: boolean) => {
    const value = next === null ? null : clampChartsHeight(next, max);
    setStored(value);
    if (save) saveChartsHeight(value);
  };
  const separator = {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({ pointerId: event.pointerId, y: event.clientY, start: height });
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      if (drag?.pointerId !== event.pointerId) return;
      // Up makes the charts taller.
      set(drag.start + drag.y - event.clientY, false);
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
      if (drag?.pointerId !== event.pointerId) return;
      setDrag(null);
      set(height, true);
    },
    onLostPointerCapture: () => {
      if (!drag) return;
      setDrag(null);
      set(height, true);
    },
    onDoubleClick: () => set(null, true),
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      const next =
        event.key === "ArrowUp"
          ? height + SPLITTER_STEP
          : event.key === "ArrowDown"
            ? height - SPLITTER_STEP
            : event.key === "Home"
              ? CHARTS_MIN_HEIGHT
              : event.key === "End"
                ? (max ?? height)
                : null;
      if (next === null) return;
      // The page's own Home / End move through the game; here they size the charts.
      event.preventDefault();
      set(next, true);
    }
  };
  return { height, max, dragging: drag !== null, measure: setSection, separator };
}
