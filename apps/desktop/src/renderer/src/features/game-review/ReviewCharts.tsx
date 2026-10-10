import {
  memo,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode
} from "react";
import type { Color } from "@chaturanga/shared/types/chess";
import type { GameOpening, MoveReview } from "@chaturanga/shared/types/engine";
import { MoveMarkGlyph } from "../board/MoveMarkGlyph";
import { useEnginesQuery } from "../../queries/api";
import { useOpenSettings } from "../settings/settings-link";
import { pickMaiaEngines } from "./review-engine-picker";
import {
  buildReviewChartData,
  chartMark,
  chartTooltipLines,
  nearestPointIndex,
  type ChartMainlineMove,
  type ChartPoint,
  type ReviewChartData
} from "./review-charts";
import {
  loadChartCollapsed,
  loadChartsHeight,
  saveChartCollapsed,
  saveChartsHeight,
  type FoldableChart
} from "./review-chart-prefs";
import {
  AXIS_HEIGHT,
  CHARTS_MIN_HEIGHT,
  chartsMaxHeight,
  clampChartsHeight,
  SPLITTER_STEP,
  fitViewHeights,
  openViews,
  resolveChartsHeight,
  STRIP_INSET,
  stripPlotHeight,
  viewHeights,
  WIN_TOP,
  winPlotHeight,
  type ChartsLayout
} from "./review-chart-layout";
import { Badge } from "@/components/ui/badge";
import { annotationTone } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { CollapsibleHeader, CollapsibleToggle } from "@/components/ui/collapsible-section";

/*
 * Geometry shared by the three views, so one x (a ply) lines up in all of them: each plot spans
 * [GUTTER, width - RIGHT] horizontally; the gutter holds the axis labels.
 */
const GUTTER = 34;
const RIGHT = 6;
/** Space between two x-axis labels. */
const TICK_SPACING = 44;
const LABEL = { fontSize: 9 } as const;

const PHASE_LABELS = { opening: "Opening", middlegame: "Middlegame", endgame: "Endgame" } as const;

type Scale = { width: number; xMax: number; x: (ply: number) => number };

function makeScale(width: number, xMax: number): Scale {
  const span = Math.max(1, width - GUTTER - RIGHT);
  const max = Math.max(1, xMax);
  return { width, xMax: max, x: (ply) => GUTTER + (ply / max) * span };
}

/** The width of a bar (one per ply): the ply's slot less a small gap. */
function barWidth(scale: Scale): number {
  const slot = (scale.width - GUTTER - RIGHT) / scale.xMax;
  return Math.max(0.6, slot - Math.min(1, slot * 0.25));
}

function markFill(point: ChartPoint): string | null {
  const mark = chartMark(point.annotation);
  return mark ? annotationTone[mark].fill : null;
}

/** The element's laid-out width in CSS pixels (0 until measured), kept up to date. */
function useWidth(): [(element: HTMLDivElement | null) => void, number, HTMLDivElement | null] {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!element) return;
    setWidth(Math.round(element.getBoundingClientRect().width));
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
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

/** A chart's fold state, remembered (review-chart-prefs.ts). */
function useFolded(chart: FoldableChart): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => loadChartCollapsed(chart));
  const toggle = useCallback(() => {
    setCollapsed((value) => {
      saveChartCollapsed(chart, !value);
      return !value;
    });
  }, [chart]);
  return [collapsed, toggle];
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
function useChartsHeight(layout: ChartsLayout, fill: boolean) {
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
    const update = () =>
      setMax(
        chartsMaxHeight(
          above.getBoundingClientRect().height,
          section.getBoundingClientRect().height
        )
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(above);
    observer.observe(section);
    return () => observer.disconnect();
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

/**
 * The review's charts, stacked and linked at the bottom of the side panel: winning chances (the
 * reviewed side's area from the bottom, the opponent's from the top, the game's phases, a dot on
 * every marked move and a ring on the key insights), how hard each best move was to find at the
 * review's Maia model, and the time each move took. They share one move axis, one current-move
 * line, one hover and one tooltip; a click jumps the board to the move, and with the charts
 * focused the arrow keys step through the moves. The drawn layers redraw only when the review or
 * the size changes; moving the selection or the hover only moves the lines.
 *
 * Their header is the Game Review header's twin (CollapsibleHeader's "section" row), right under
 * the divider line between the panel content and the charts. A splitter over that line sets the
 * charts' height: dragged, with the arrow keys, or reset by a double-click; the winning-chances
 * view takes the height beyond the other views. It overlays the line (an 8 px hit area centred on
 * it, adding no height) and spans the panel footer's padding (`-inset-x-3` of its `px-3`).
 */
export const ReviewCharts = memo(function ReviewCharts({
  moves,
  selectedNodeId,
  onSelectNode,
  reviewedSide,
  variationSelected = false,
  totalPlies,
  keyMomentIds,
  opening,
  mainline,
  timeControl,
  maia,
  fill = false,
  maiaPrompt = true
}: {
  moves: readonly MoveReview[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  /** The side being reviewed: its winning chances fill from the bottom. */
  reviewedSide: Color;
  /** The selected node is off the main line, so no move is marked current. */
  variationSelected?: boolean;
  /**
   * Fix the move axis to the whole game (while the review is still running) so the charts grow
   * left to right instead of re-scaling on every new move.
   */
  totalPlies?: number;
  /** Node ids of the review's key moments: their dots are ringed. */
  keyMomentIds?: ReadonlySet<string>;
  /** The review's opening (it ends the Opening phase); undefined for a review without book data. */
  opening: GameOpening | null | undefined;
  /** The game's main line, with each move's `[%clk]`. */
  mainline: readonly ChartMainlineMove[];
  timeControl: string | null | undefined;
  maia: { model: number | null; rating: number; trusted: boolean };
  /**
   * Take all the height the panel gives the charts (flex), as when the Review section above is
   * folded: no splitter (nothing above to trade with), its height ignored. The parent lays the
   * charts out as a flex column.
   */
  fill?: boolean;
  /**
   * Without Maia data, put a one-line prompt in the difficulty strip's place (Game review, where
   * a review can run Maia); false hides the strip instead (the Analyze page).
   */
  maiaPrompt?: boolean;
}) {
  // The page passes `maia` as a fresh object each render; its fields are what the data uses.
  const { model: maiaModel, rating, trusted } = maia;
  const data = useMemo(
    () =>
      buildReviewChartData({
        moves,
        keyMomentIds,
        opening,
        mainline,
        timeControl,
        maia: { model: maiaModel, rating, trusted }
      }),
    [moves, keyMomentIds, opening, mainline, timeControl, maiaModel, rating, trusted]
  );
  const { points } = data;
  const lastPly = points[points.length - 1]?.ply ?? 0;
  const [measure, width, viewsElement] = useWidth();
  const scale = useMemo(
    () => makeScale(width, totalPlies ? Math.max(totalPlies, lastPly) : lastPly),
    [lastPly, totalPlies, width]
  );
  const indexByNode = useMemo(
    () => new Map(points.map((point, index) => [point.nodeId, index])),
    [points]
  );
  const selectedIndex = variationSelected ? -1 : (indexByNode.get(selectedNodeId ?? "") ?? -1);
  const [hoverIndex, setHoverIndex] = useState(-1);
  const [focused, setFocused] = useState(false);
  const [difficultyCollapsed, toggleDifficulty] = useFolded("difficulty");
  const [timesCollapsed, toggleTimes] = useFolded("times");
  const [chartsCollapsed, toggleCharts] = useFolded("charts");
  const [winCollapsed, toggleWin] = useFolded("win");
  const maiaInstalled = useMaiaInstalled();
  const descriptionId = useId();
  const difficultyId = useId();
  const timesId = useId();
  const viewsId = useId();
  const winId = useId();

  const indexAt = useCallback(
    (event: MouseEvent<SVGSVGElement>) => {
      const left = event.currentTarget.getBoundingClientRect().left;
      const span = Math.max(1, scale.width - GUTTER - RIGHT);
      const ply = ((event.clientX - left - GUTTER) / span) * scale.xMax;
      return nearestPointIndex(points, ply);
    },
    [points, scale]
  );
  const pointer = useMemo(
    () => ({
      onPointerMove: (event: MouseEvent<SVGSVGElement>) => setHoverIndex(indexAt(event)),
      onPointerLeave: () => setHoverIndex(-1),
      onClick: (event: MouseEvent<SVGSVGElement>) => {
        const point = points[indexAt(event)];
        if (point) onSelectNode(point.nodeId);
      }
    }),
    [indexAt, onSelectNode, points]
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Only the charts themselves: a fold button inside keeps its own keys.
    if (event.target !== event.currentTarget || !points.length) return;
    const from = selectedIndex < 0 ? 0 : selectedIndex;
    const next =
      event.key === "ArrowLeft"
        ? Math.max(0, from - 1)
        : event.key === "ArrowRight"
          ? selectedIndex < 0
            ? 0
            : Math.min(points.length - 1, from + 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? points.length - 1
              : null;
    if (next === null) return;
    // Handled here: the page's own ← → shortcuts must not step a second time.
    event.preventDefault();
    const point = points[next];
    if (point && next !== selectedIndex) onSelectNode(point.nodeId);
  };

  const showDifficulty = data.hasDifficulty && data.model !== null;
  const layout: ChartsLayout = {
    win: winCollapsed ? "folded" : data.hasEvals ? "open" : "empty",
    difficulty: showDifficulty
      ? difficultyCollapsed
        ? "folded"
        : "open"
      : !maiaPrompt || maiaInstalled === null
        ? "none"
        : "prompt",
    times: data.hasTimes ? (timesCollapsed ? "folded" : "open") : "none"
  };
  const {
    height: chartsHeight,
    max: chartsMax,
    dragging,
    measure: measureSection,
    separator
  } = useChartsHeight(layout, fill);
  // The open views share the height beyond the fixed rows equally, each above its minimum.
  const viewsBox = useViewsBox(
    viewsElement,
    `${layout.win}|${layout.difficulty}|${layout.times}|${width > 0}`
  );
  const views = viewsBox
    ? fitViewHeights({ ...viewsBox, open: openViews(layout) })
    : viewHeights(chartsHeight, layout);
  const winPlot = winPlotHeight(views.win ?? 0);
  // The shared move axis sits under the last open view.
  const lastOpen =
    views.times !== null
      ? "times"
      : views.difficulty !== null
        ? "difficulty"
        : views.win !== null
          ? "win"
          : null;
  const axis =
    width > 0 ? (
      <svg width={width} height={AXIS_HEIGHT} className="block font-mono" aria-hidden>
        <AxisLayer scale={scale} />
      </svg>
    ) : null;
  const difficultyPlot = stripPlotHeight(views.difficulty ?? 0);
  const timesPlot = stripPlotHeight(views.times ?? 0);
  const sectionId = useId();
  const shownIndex = hoverIndex >= 0 ? hoverIndex : -1;
  const hovered = points[shownIndex] ?? null;
  const selected = points[selectedIndex] ?? null;
  const cursor = {
    selectedX: selected ? scale.x(selected.ply) : null,
    hoverX: hovered ? scale.x(hovered.ply) : null
  };

  return (
    <section
      ref={measureSection}
      id={sectionId}
      className={cn("relative flex min-w-0 flex-col", fill && !chartsCollapsed && "min-h-0 flex-1")}
      style={chartsCollapsed || fill ? undefined : { height: chartsHeight }}
      aria-label="Game charts"
    >
      {chartsCollapsed || fill ? null : (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize the charts"
          aria-controls={sectionId}
          aria-valuenow={chartsHeight}
          aria-valuemin={CHARTS_MIN_HEIGHT}
          aria-valuemax={Math.max(CHARTS_MIN_HEIGHT, chartsMax ?? chartsHeight)}
          tabIndex={0}
          title="Drag to resize the charts · double-click to reset"
          data-dragging={dragging || undefined}
          // Over the divider line just above the section (the footer's top border), centred on it.
          className="group/splitter absolute -inset-x-3 -top-1 z-10 h-2 cursor-row-resize touch-none outline-none"
          {...separator}
        >
          {/* A neutral highlight over the boundary line while hovered, focused or dragged. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0.5 h-[3px] transition-colors duration-micro ease-standard group-hover/splitter:bg-fg/15 group-focus-visible/splitter:bg-fg/25 group-data-[dragging]/splitter:bg-fg/20"
          />
        </div>
      )}
      <CollapsibleHeader
        open={!chartsCollapsed}
        onToggle={toggleCharts}
        controls={viewsId}
        actions={
          variationSelected ? (
            <Badge tone="warn" className="animate-fade-in">
              Variation
            </Badge>
          ) : null
        }
      >
        Charts
      </CollapsibleHeader>
      {chartsCollapsed ? (
        <div id={viewsId} hidden />
      ) : (
        <>
          {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the focused charts step through the moves with the arrow keys, like a slider, but hold the fold buttons a slider would hide */}
          <div
            ref={measure}
            id={viewsId}
            role="group"
            aria-roledescription="charts"
            aria-label="Winning chances, difficulty and time per move"
            aria-describedby={descriptionId}
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the charts take focus so the arrow keys can step through the moves they plot
            tabIndex={0}
            onKeyDown={onKeyDown}
            onFocus={(event) => setFocused(event.target === event.currentTarget)}
            onBlur={() => setFocused(false)}
            className="relative grid min-h-0 min-w-0 flex-1 content-start gap-1 overflow-x-hidden overflow-y-auto rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          >
            <p id={descriptionId} className="sr-only">
              {chartsDescription(data)}
            </p>
            {focused && selected ? (
              <p aria-live="polite" className="sr-only">
                {chartTooltipLines(selected, reviewedSide, data.model).join(", ")}
              </p>
            ) : null}
            {width > 0 ? (
              <>
                <FoldToggle collapsed={winCollapsed} onToggle={toggleWin} controls={winId}>
                  Winning chances
                </FoldToggle>
                {winCollapsed ? (
                  <div id={winId} hidden />
                ) : !data.hasEvals ? (
                  <p
                    id={winId}
                    className="text-2xs text-fg-subtle"
                    style={{ paddingLeft: GUTTER }}
                    data-no-evals
                  >
                    No evaluations yet: review the game to see its winning chances.
                  </p>
                ) : (
                  <svg
                    id={winId}
                    width={width}
                    height={views.win ?? 0}
                    className="block cursor-pointer font-mono"
                    data-chart="winning-chances"
                    aria-hidden
                    {...pointer}
                  >
                    <WinningChancesLayer
                      data={data}
                      scale={scale}
                      plot={winPlot}
                      reviewedSide={reviewedSide}
                    />
                    <Cursor {...cursor} top={WIN_TOP} bottom={WIN_TOP + winPlot} />
                  </svg>
                )}
                {lastOpen === "win" ? axis : null}
                {showDifficulty ? (
                  <>
                    <FoldToggle
                      collapsed={difficultyCollapsed}
                      onToggle={toggleDifficulty}
                      controls={difficultyId}
                    >
                      Difficulty at {data.model} · Maia
                    </FoldToggle>
                    {difficultyCollapsed ? (
                      <div id={difficultyId} hidden />
                    ) : (
                      <svg
                        id={difficultyId}
                        width={width}
                        height={views.difficulty ?? 0}
                        className="block cursor-pointer font-mono"
                        data-chart="difficulty"
                        aria-hidden
                        {...pointer}
                      >
                        <DifficultyLayer points={points} scale={scale} plot={difficultyPlot} />
                        <Cursor
                          {...cursor}
                          top={STRIP_INSET}
                          bottom={STRIP_INSET + difficultyPlot}
                        />
                      </svg>
                    )}
                  </>
                ) : !maiaPrompt || maiaInstalled === null ? null : (
                  <MaiaPrompt installed={maiaInstalled} />
                )}
                {lastOpen === "difficulty" ? axis : null}
                {data.hasTimes ? (
                  <>
                    <FoldToggle
                      collapsed={timesCollapsed}
                      onToggle={toggleTimes}
                      controls={timesId}
                    >
                      Time per move
                    </FoldToggle>
                    {timesCollapsed ? (
                      <div id={timesId} hidden />
                    ) : (
                      <svg
                        id={timesId}
                        width={width}
                        height={views.times ?? 0}
                        className="block cursor-pointer font-mono"
                        data-chart="times"
                        aria-hidden
                        {...pointer}
                      >
                        <TimesLayer points={points} scale={scale} plot={timesPlot} />
                        <Cursor {...cursor} top={STRIP_INSET} bottom={STRIP_INSET + timesPlot} />
                      </svg>
                    )}
                  </>
                ) : null}
                {lastOpen === "times" ? axis : null}
              </>
            ) : (
              // Reserves the winning-chances view's height until the width is known.
              <div style={{ height: views.win ?? 0 }} aria-hidden />
            )}
            {hovered && width > 0 ? (
              <ChartTooltip
                point={hovered}
                lines={chartTooltipLines(hovered, reviewedSide, data.model)}
                x={scale.x(hovered.ply)}
                width={width}
              />
            ) : null}
          </div>
        </>
      )}
    </section>
  );
});

/** What the charts show, for screen readers (the views themselves are drawn, not read). */
function chartsDescription(data: ReviewChartData): string {
  const views = ["the winning chances after each move, the reviewed side's from the bottom"];
  if (data.hasDifficulty && data.model !== null)
    views.push(`how hard the best move was to find at Maia ${data.model}`);
  if (data.hasTimes) views.push("the time each move took");
  return `Charts of ${views.join(", ")}. Marked moves are coloured; ringed ones are the key insights. The left and right arrow keys step through the moves, Home and End go to the start and the end.`;
}

/** Whether a Maia model is installed; null while the engines load. */
function useMaiaInstalled(): boolean | null {
  const engines = useEnginesQuery();
  if (!engines.data) return null;
  return pickMaiaEngines(engines.data).length > 0;
}

/**
 * The difficulty view's place when the review has no Maia data: one line pointing to where Maia is
 * installed, or (with Maia installed) to analysing again with it.
 */
function MaiaPrompt({ installed }: { installed: boolean }) {
  const openSettings = useOpenSettings();
  if (installed)
    return (
      <p className="text-2xs text-fg-subtle" style={{ paddingLeft: GUTTER }} data-maia-prompt>
        Difficulty needs Maia: analyse the game again with Maia on.
      </p>
    );
  return (
    <p className="text-2xs text-fg-subtle" style={{ paddingLeft: GUTTER }} data-maia-prompt>
      Difficulty needs a Maia model.{" "}
      {openSettings ? (
        <button
          type="button"
          className="text-accent underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
          onClick={() => openSettings("engines")}
        >
          Install Maia
        </button>
      ) : (
        "Install Maia in Settings → Engines."
      )}
    </p>
  );
}

/**
 * A folding strip's label: the panel's shared left-chevron toggle, in the strips' small mono type,
 * its title over the plot's left edge.
 */
function FoldToggle({
  collapsed,
  onToggle,
  controls,
  children
}: {
  collapsed: boolean;
  onToggle: () => void;
  controls: string;
  children: ReactNode;
}) {
  return (
    <div className="justify-self-start pt-1" style={{ paddingLeft: GUTTER - 18 }}>
      <CollapsibleToggle
        open={!collapsed}
        onToggle={onToggle}
        controls={controls}
        // `!`: the shared toggle sets the section-title size, which tailwind-merge keeps beside 2xs.
        className="font-mono !text-2xs font-normal text-fg-muted"
      >
        {children}
      </CollapsibleToggle>
    </div>
  );
}

/** The current move's line (accent) and the hovered move's (subtle), through one view. */
function Cursor({
  selectedX,
  hoverX,
  top,
  bottom
}: {
  selectedX: number | null;
  hoverX: number | null;
  top: number;
  bottom: number;
}) {
  return (
    <g pointerEvents="none">
      {hoverX !== null && hoverX !== selectedX ? (
        <line
          x1={hoverX}
          x2={hoverX}
          y1={top}
          y2={bottom}
          stroke="var(--color-fg-muted)"
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      ) : null}
      {selectedX !== null ? (
        <line
          data-current-move
          x1={0}
          x2={0}
          y1={top}
          y2={bottom}
          stroke="var(--color-accent)"
          strokeWidth={1.4}
          style={{ transform: `translateX(${selectedX}px)` }}
          className="transition-transform duration-standard ease-enter"
        />
      ) : null}
    </g>
  );
}

/** The phases inside the axis: where each starts (as an x in plies) and its label. */
function phaseBands(data: ReviewChartData, xMax: number) {
  const { openingEnd, endgameStart } = data.phases;
  const middleEnd = Math.min(xMax, (endgameStart ?? xMax + 1) - 1);
  const bands: { from: number; to: number; label: string }[] = [];
  if (openingEnd >= 1)
    bands.push({ from: 0, to: Math.min(openingEnd, xMax), label: PHASE_LABELS.opening });
  if (openingEnd < middleEnd)
    bands.push({ from: openingEnd, to: middleEnd, label: PHASE_LABELS.middlegame });
  if (endgameStart !== null && endgameStart <= xMax)
    bands.push({ from: endgameStart - 1, to: xMax, label: PHASE_LABELS.endgame });
  return bands;
}

/** A label's width at the charts' 9px mono, with a little room. */
function labelRoom(label: string): number {
  return label.length * 5.6 + 6;
}

/**
 * An opening too short for its label (a game that left the book in a move or two) merges into the
 * axis start: no divider hugging the left edge, and the middlegame's label starts there.
 */
function tidyBands(bands: ReturnType<typeof phaseBands>, x: (ply: number) => number) {
  const [first, second, ...rest] = bands;
  if (first?.label !== PHASE_LABELS.opening || !second) return bands;
  if (x(first.to) - x(first.from) >= labelRoom(first.label)) return bands;
  return [{ ...second, from: 0 }, ...rest];
}

const WinningChancesLayer = memo(function WinningChancesLayer({
  data,
  scale,
  plot,
  reviewedSide
}: {
  data: ReviewChartData;
  scale: Scale;
  /** The plot's height (the view takes the charts area's spare height). */
  plot: number;
  reviewedSide: Color;
}) {
  // The moves the review has evaluated (every move but those a running review hasn't reached).
  const points = data.points.flatMap((point) =>
    point.whiteWin === null ? [] : [{ ...point, whiteWin: point.whiteWin }]
  );
  const { x } = scale;
  const bottom = WIN_TOP + plot;
  // The reviewed side's winning chances, drawn up from the bottom.
  const y = (point: { whiteWin: number }) => {
    const own = reviewedSide === "white" ? point.whiteWin : 100 - point.whiteWin;
    return WIN_TOP + (1 - own / 100) * plot;
  };
  const last = points[points.length - 1];
  const area = last
    ? `${points.map((point, index) => `${index ? "L" : "M"}${x(point.ply).toFixed(1)} ${y(point).toFixed(1)}`).join("")}L${x(last.ply).toFixed(1)} ${bottom}L${x(0)} ${bottom}Z`
    : "";
  const ownFill = reviewedSide === "white" ? "var(--color-eval-white)" : "var(--color-eval-black)";
  const otherFill =
    reviewedSide === "white" ? "var(--color-eval-black)" : "var(--color-eval-white)";
  const half = WIN_TOP + plot / 2;
  const bands = tidyBands(phaseBands(data, scale.xMax), x);
  return (
    <g>
      {last ? (
        <>
          <rect
            x={x(0)}
            y={WIN_TOP}
            width={Math.max(0, x(last.ply) - x(0))}
            height={plot}
            fill={otherFill}
          />
          <path d={area} fill={ownFill} />
        </>
      ) : null}
      <line
        x1={GUTTER}
        x2={scale.width - RIGHT}
        y1={half}
        y2={half}
        stroke="var(--color-fg-subtle)"
        strokeWidth={0.8}
        strokeDasharray="3 4"
      />
      {bands.map((band, index) => {
        const room = x(band.to) - x(band.from);
        return (
          <g key={band.label} data-phase={band.label}>
            {index > 0 ? (
              <line
                x1={x(band.from)}
                x2={x(band.from)}
                y1={1}
                y2={bottom}
                stroke="var(--color-fg-subtle)"
                strokeWidth={0.8}
              />
            ) : null}
            {room >= labelRoom(band.label) ? (
              <text x={x(band.from) + 3} y={9} {...LABEL} fill="var(--color-fg-muted)">
                {band.label}
              </text>
            ) : null}
          </g>
        );
      })}
      {[100, 50, 0].map((value) => (
        <text
          key={value}
          x={GUTTER - 4}
          y={WIN_TOP + (1 - value / 100) * plot + 3}
          {...LABEL}
          fontSize={8.5}
          fill="var(--color-fg-subtle)"
          textAnchor="end"
        >
          {value}%
        </text>
      ))}
      {points.map((point) => {
        const fill = markFill(point);
        if (!fill) return null;
        const cx = x(point.ply);
        const cy = y(point);
        return (
          <g key={point.nodeId}>
            {point.key ? (
              <circle
                cx={cx}
                cy={cy}
                r={5.5}
                fill="none"
                stroke="var(--color-fg)"
                strokeWidth={1}
                opacity={0.85}
              />
            ) : null}
            <circle
              cx={cx}
              cy={cy}
              r={3.2}
              fill={fill}
              stroke="var(--color-canvas)"
              strokeWidth={0.9}
              data-ply={point.ply}
              data-annotation={chartMark(point.annotation) ?? undefined}
              data-key-moment={point.key ? "true" : undefined}
            />
          </g>
        );
      })}
    </g>
  );
});

const DifficultyLayer = memo(function DifficultyLayer({
  points,
  scale,
  plot
}: {
  points: readonly ChartPoint[];
  scale: Scale;
  /** The plot's height (the strip's share of the charts area). */
  plot: number;
}) {
  const base = STRIP_INSET + plot;
  const width = barWidth(scale);
  return (
    <g>
      <text
        x={GUTTER - 4}
        y={STRIP_INSET + 7}
        {...LABEL}
        fill="var(--color-fg-subtle)"
        textAnchor="end"
      >
        hard
      </text>
      <text x={GUTTER - 4} y={base} {...LABEL} fill="var(--color-fg-subtle)" textAnchor="end">
        easy
      </text>
      <line x1={GUTTER} x2={scale.width - RIGHT} y1={base} y2={base} stroke="var(--color-line)" />
      {points.map((point) => {
        if (point.bestChance === null) return null;
        const height = Math.max(1, (1 - point.bestChance) * plot);
        return (
          <rect
            key={point.nodeId}
            x={scale.x(point.ply) - width / 2}
            y={base - height}
            width={width}
            height={height}
            rx={0.8}
            fill={markFill(point) ?? "var(--color-line-strong)"}
            data-ply={point.ply}
          />
        );
      })}
    </g>
  );
});

const TimesLayer = memo(function TimesLayer({
  points,
  scale,
  plot
}: {
  points: readonly ChartPoint[];
  scale: Scale;
  /** The plot's height (the strip's share of the charts area). */
  plot: number;
}) {
  const middle = STRIP_INSET + plot / 2;
  const width = barWidth(scale);
  let longest = 0;
  for (const point of points) longest = Math.max(longest, point.spentMs ?? 0);
  return (
    <g>
      <text
        x={GUTTER - 4}
        y={STRIP_INSET + 7}
        {...LABEL}
        fill="var(--color-fg-subtle)"
        textAnchor="end"
      >
        White
      </text>
      <text
        x={GUTTER - 4}
        y={STRIP_INSET + plot}
        {...LABEL}
        fill="var(--color-fg-subtle)"
        textAnchor="end"
      >
        Black
      </text>
      <line
        x1={GUTTER}
        x2={scale.width - RIGHT}
        y1={middle}
        y2={middle}
        stroke="var(--color-line)"
      />
      {longest > 0
        ? points.map((point) => {
            if (point.spentMs === null || point.mover === null) return null;
            const height = Math.max(0.5, (point.spentMs / longest) * (plot / 2 - 1));
            const white = point.mover === "white";
            return (
              <rect
                key={point.nodeId}
                x={scale.x(point.ply) - width / 2}
                y={white ? middle - height : middle}
                width={width}
                height={height}
                fill={
                  markFill(point) ?? (white ? "var(--color-side-white)" : "var(--color-fg-subtle)")
                }
                data-ply={point.ply}
              />
            );
          })
        : null}
    </g>
  );
});

/** Ply numbers under the views, as many as fit. */
const AxisLayer = memo(function AxisLayer({ scale }: { scale: Scale }) {
  const span = scale.width - GUTTER - RIGHT;
  const fit = Math.max(1, Math.floor(span / TICK_SPACING));
  const step = [1, 2, 5, 10, 20, 50, 100, 200].find((value) => scale.xMax / value <= fit) ?? 500;
  const ticks: number[] = [];
  for (let ply = 0; ply <= scale.xMax; ply += step) ticks.push(ply);
  return (
    <g>
      {ticks.map((ply) => (
        <text
          key={ply}
          x={scale.x(ply)}
          y={10}
          {...LABEL}
          fill="var(--color-fg-subtle)"
          textAnchor="middle"
        >
          {ply}
        </text>
      ))}
    </g>
  );
});

/** The hovered move's tooltip, beside its line (to the left in the charts' right half). */
function ChartTooltip({
  point,
  lines,
  x,
  width
}: {
  point: ChartPoint;
  lines: string[];
  x: number;
  width: number;
}) {
  const left = x > width / 2;
  const [title, ...rest] = lines;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-4 z-10 grid max-w-56 gap-0.5 rounded-lg border border-line bg-surface-raised px-2 py-1.5 text-2xs text-fg-muted shadow-popover"
      style={{
        left: x,
        transform: left ? "translateX(calc(-100% - 10px))" : "translateX(10px)"
      }}
      data-chart-tooltip
    >
      <p className="flex items-center gap-1.5 whitespace-nowrap font-mono text-xs text-fg-secondary">
        {point.annotation ? (
          <svg viewBox="0 0 100 100" className="size-4 shrink-0" aria-hidden>
            <circle cx={50} cy={50} r={50} fill={annotationTone[point.annotation].fill} />
            <g fill="var(--color-mark-fg)" className="text-mark-fg">
              <MoveMarkGlyph annotation={point.annotation} />
            </g>
          </svg>
        ) : null}
        {title}
      </p>
      {rest.map((line) => (
        <p key={line} className="whitespace-nowrap">
          {line}
        </p>
      ))}
    </div>
  );
}
