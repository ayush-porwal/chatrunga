import {
  memo,
  useCallback,
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode
} from "react";
import type { Color } from "@chaturanga/shared/types/chess";
import type { GameOpening, MoveReview } from "@chaturanga/shared/types/engine";
import { useMaia3Installed } from "../../queries/maia";
import { MaiaDownloadPrompt } from "./MaiaDownloadPrompt";
import {
  buildReviewChartData,
  chartTooltip,
  chartTooltipText,
  difficultyTitle,
  nearestPointIndex,
  winningChancesTitle,
  type ChartMainlineMove,
  type ChartPoint,
  type ReviewChartData
} from "./review-charts";
import {
  AXIS_HEIGHT,
  CHARTS_MIN_HEIGHT,
  chartsLayout,
  lastOpenView,
  STRIP_INSET,
  stripPlotHeight,
  WIN_TOP,
  winPlotHeight,
  type ChartsLayout,
  type ViewHeights
} from "./review-chart-layout";
import {
  useChartsHeight,
  useFold,
  useViewHeights,
  useWidth,
  type Fold
} from "./use-review-chart-sizing";
import {
  AxisLayer,
  ChartTooltip,
  Cursor,
  DifficultyLayer,
  GUTTER,
  makeScale,
  plyAt,
  TimesLayer,
  WinningChancesLayer,
  type Scale
} from "./ReviewChartLayers";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CollapsibleHeader, CollapsibleToggle } from "@/components/ui/collapsible-section";

/**
 * The review's charts, stacked and linked at the bottom of the side panel: winning chances (the
 * reviewed side's area from the bottom, the opponent's from the top, the game's phases, a dot on
 * every marked move and a ring on the key insights), how hard each best move was to find at the
 * rating Maia read it at (the mover's for Maia 3, the review's model for Maia 1), and the time
 * each move took. They share one move axis, one current-move
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
  evalEngine = null,
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
  /** The display name of the engine whose evaluations the winning chances are (null: unknown). */
  evalEngine?: string | null;
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
  const charts = useFold("charts");
  const win = useFold("win");
  const difficulty = useFold("difficulty");
  const times = useFold("times");
  const maiaInstalled = useMaia3Installed();
  const layout = chartsLayout({
    hasEvals: data.hasEvals,
    hasDifficulty: data.hasDifficulty && data.model !== null,
    hasTimes: data.hasTimes,
    folded: { win: win.collapsed, difficulty: difficulty.collapsed, times: times.collapsed },
    maiaPrompt: maiaPrompt && maiaInstalled !== null
  });
  const {
    height: chartsHeight,
    max: chartsMax,
    dragging,
    measure: measureSection,
    separator
  } = useChartsHeight(layout, fill);
  const sectionId = useId();
  // The splitter sizes the open charts, unless they fill the panel.
  const resizable = !charts.collapsed && !fill;

  return (
    <section
      ref={measureSection}
      id={sectionId}
      className={cn(
        "relative flex min-w-0 flex-col",
        fill && !charts.collapsed && "min-h-0 flex-1"
      )}
      style={resizable ? { height: chartsHeight } : undefined}
      aria-label="Game charts"
    >
      {resizable ? (
        <ChartsSplitter
          controls={sectionId}
          height={chartsHeight}
          max={chartsMax}
          dragging={dragging}
          separator={separator}
        />
      ) : null}
      <CollapsibleHeader
        open={!charts.collapsed}
        onToggle={charts.toggle}
        controls={charts.id}
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
      {charts.collapsed ? (
        <div id={charts.id} hidden />
      ) : (
        <ChartViews
          id={charts.id}
          data={data}
          layout={layout}
          folds={{ win, difficulty, times }}
          height={chartsHeight}
          totalPlies={totalPlies}
          selectedNodeId={variationSelected ? null : selectedNodeId}
          onSelectNode={onSelectNode}
          reviewedSide={reviewedSide}
          evalEngine={evalEngine}
        />
      )}
    </section>
  );
});

/** The splitter over the divider line just above the charts: dragged or stepped, it sizes them. */
function ChartsSplitter({
  controls,
  height,
  max,
  dragging,
  separator
}: {
  controls: string;
  height: number;
  max: number | null;
  dragging: boolean;
  separator: ReturnType<typeof useChartsHeight>["separator"];
}) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the charts"
      aria-controls={controls}
      aria-valuenow={height}
      aria-valuemin={CHARTS_MIN_HEIGHT}
      aria-valuemax={Math.max(CHARTS_MIN_HEIGHT, max ?? height)}
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
  );
}

/** The plies the move axis spans: the moves charted, or a running review's whole game. */
function axisPlies(points: readonly ChartPoint[], totalPlies: number | undefined): number {
  const lastPly = points.at(-1)?.ply ?? 0;
  return totalPlies ? Math.max(totalPlies, lastPly) : lastPly;
}

/** What every view shares: its width and move scale, the pointer and the current/hover lines. */
type ChartFrame = {
  width: number;
  scale: Scale;
  pointer: ReturnType<typeof useChartPointer>["pointer"];
  cursor: { selectedX: number | null; hoverX: number | null };
};

/**
 * The open charts: the views (folding one by one) over one move axis, focusable to step through
 * the moves with the arrow keys, with the hovered move's tooltip. `selectedNodeId` is null while a
 * variation is selected: no move is current then.
 */
function ChartViews({
  id,
  data,
  layout,
  folds,
  height,
  totalPlies,
  selectedNodeId,
  onSelectNode,
  reviewedSide,
  evalEngine
}: {
  id: string;
  data: ReviewChartData;
  layout: ChartsLayout;
  folds: Record<keyof ViewHeights, Fold>;
  /** The charts area's height. */
  height: number;
  totalPlies: number | undefined;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  reviewedSide: Color;
  evalEngine: string | null;
}) {
  const { points } = data;
  const [measure, width, viewsElement] = useWidth();
  const xMax = axisPlies(points, totalPlies);
  const scale = useMemo(() => makeScale(width, xMax), [xMax, width]);
  const { hovered, selected, pointer, onKeyDown } = useChartPointer({
    points,
    scale,
    selectedNodeId,
    onSelectNode
  });
  const [focused, setFocused] = useState(false);
  const descriptionId = useId();
  const views = useViewHeights(viewsElement, layout, height, width > 0);
  const frame: ChartFrame = {
    width,
    scale,
    pointer,
    cursor: {
      selectedX: selected ? scale.x(selected.ply) : null,
      hoverX: hovered ? scale.x(hovered.ply) : null
    }
  };
  // The shared move axis sits under the last open view.
  const lastOpen = lastOpenView(views);
  const axisAfter = (view: keyof ViewHeights) =>
    lastOpen === view ? (
      <svg width={width} height={AXIS_HEIGHT} className="block font-mono" aria-hidden>
        <AxisLayer scale={scale} />
      </svg>
    ) : null;

  return (
    <>
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the focused charts step through the moves with the arrow keys, like a slider, but hold the fold buttons a slider would hide */}
      <div
        ref={measure}
        id={id}
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
            {chartTooltipText(chartTooltip(selected, reviewedSide, evalEngine))}
          </p>
        ) : null}
        {width > 0 ? (
          <>
            <WinningChancesView
              fold={folds.win}
              frame={frame}
              height={views.win}
              data={data}
              reviewedSide={reviewedSide}
              evalEngine={evalEngine}
            />
            {axisAfter("win")}
            {layout.difficulty === "prompt" ? (
              <MaiaPrompt />
            ) : layout.difficulty === "none" ? null : (
              <DifficultyView
                fold={folds.difficulty}
                frame={frame}
                height={views.difficulty}
                points={points}
              />
            )}
            {axisAfter("difficulty")}
            {layout.times === "none" ? null : (
              <TimesView fold={folds.times} frame={frame} height={views.times} points={points} />
            )}
            {axisAfter("times")}
          </>
        ) : (
          // Reserves the winning-chances view's height until the width is known.
          <div style={{ height: views.win ?? 0 }} aria-hidden />
        )}
        {hovered && width > 0 ? (
          <ChartTooltip
            point={hovered}
            tooltip={chartTooltip(hovered, reviewedSide, evalEngine)}
            x={scale.x(hovered.ply)}
            width={width}
          />
        ) : null}
      </div>
    </>
  );
}

/**
 * The views' pointer and keys: the hovered move (the nearest to the pointer) and the current one,
 * a click jumping the board to a move, and the arrow keys, Home and End stepping through them.
 */
function useChartPointer({
  points,
  scale,
  selectedNodeId,
  onSelectNode
}: {
  points: readonly ChartPoint[];
  scale: Scale;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}) {
  const indexByNode = useMemo(
    () => new Map(points.map((point, index) => [point.nodeId, index])),
    [points]
  );
  const selectedIndex = selectedNodeId === null ? -1 : (indexByNode.get(selectedNodeId) ?? -1);
  const [hoverIndex, setHoverIndex] = useState(-1);

  const indexAt = useCallback(
    (event: MouseEvent<SVGSVGElement>) => {
      const left = event.currentTarget.getBoundingClientRect().left;
      return nearestPointIndex(points, plyAt(scale, event.clientX - left));
    },
    [points, scale]
  );
  const pointer = useMemo(
    () => ({
      onPointerMove: (event: MouseEvent<SVGSVGElement>) => setHoverIndex(indexAt(event)),
      onPointerLeave: () => setHoverIndex(-1),
      onClick: (event: MouseEvent<SVGSVGElement>) => {
        const index = indexAt(event);
        if (index >= 0) onSelectNode(points[index].nodeId);
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
    if (next !== selectedIndex) onSelectNode(points[next].nodeId);
  };

  return {
    // The hovered index can outlive a shorter set of points; the selected one is looked up in them.
    hovered: hoverIndex >= 0 ? (points.at(hoverIndex) ?? null) : null,
    selected: selectedIndex >= 0 ? points[selectedIndex] : null,
    pointer,
    onKeyDown
  };
}

/** One view's drawing: an SVG the width of the charts, hovered and clicked through the moves. */
function ChartSvg({
  id,
  chart,
  height,
  frame,
  children
}: {
  id: string;
  /** Its `data-chart` name (the views area's measurement skips these rows). */
  chart: string;
  height: number | null;
  frame: ChartFrame;
  children: ReactNode;
}) {
  return (
    <svg
      id={id}
      width={frame.width}
      height={height ?? 0}
      className="block cursor-pointer font-mono"
      data-chart={chart}
      aria-hidden
      {...frame.pointer}
    >
      {children}
    </svg>
  );
}

/** A view under its fold toggle: `children` while it is open, an empty placeholder folded. */
function FoldingView({
  fold,
  label,
  children
}: {
  fold: Fold;
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <FoldToggle collapsed={fold.collapsed} onToggle={fold.toggle} controls={fold.id}>
        {label}
      </FoldToggle>
      {fold.collapsed ? <div id={fold.id} hidden /> : children}
    </>
  );
}

function WinningChancesView({
  fold,
  frame,
  height,
  data,
  reviewedSide,
  evalEngine
}: {
  fold: Fold;
  frame: ChartFrame;
  height: number | null;
  data: ReviewChartData;
  reviewedSide: Color;
  evalEngine: string | null;
}) {
  const plot = winPlotHeight(height ?? 0);
  return (
    <FoldingView fold={fold} label={winningChancesTitle(evalEngine)}>
      {data.hasEvals ? (
        <ChartSvg id={fold.id} chart="winning-chances" height={height} frame={frame}>
          <WinningChancesLayer
            data={data}
            scale={frame.scale}
            plot={plot}
            reviewedSide={reviewedSide}
          />
          <Cursor {...frame.cursor} top={WIN_TOP} bottom={WIN_TOP + plot} />
        </ChartSvg>
      ) : (
        <p
          id={fold.id}
          className="text-2xs text-fg-subtle"
          style={{ paddingLeft: GUTTER }}
          data-no-evals
        >
          No evaluations yet: review the game to see its winning chances.
        </p>
      )}
    </FoldingView>
  );
}

function DifficultyView({
  fold,
  frame,
  height,
  points
}: {
  fold: Fold;
  frame: ChartFrame;
  height: number | null;
  points: readonly ChartPoint[];
}) {
  const plot = stripPlotHeight(height ?? 0);
  const title = useMemo(() => difficultyTitle(points), [points]);
  return (
    <FoldingView fold={fold} label={title ?? "Difficulty · Maia"}>
      <ChartSvg id={fold.id} chart="difficulty" height={height} frame={frame}>
        <DifficultyLayer points={points} scale={frame.scale} plot={plot} />
        <Cursor {...frame.cursor} top={STRIP_INSET} bottom={STRIP_INSET + plot} />
      </ChartSvg>
    </FoldingView>
  );
}

function TimesView({
  fold,
  frame,
  height,
  points
}: {
  fold: Fold;
  frame: ChartFrame;
  height: number | null;
  points: readonly ChartPoint[];
}) {
  const plot = stripPlotHeight(height ?? 0);
  return (
    <FoldingView fold={fold} label="Time per move">
      <ChartSvg id={fold.id} chart="times" height={height} frame={frame}>
        <TimesLayer points={points} scale={frame.scale} plot={plot} />
        <Cursor {...frame.cursor} top={STRIP_INSET} bottom={STRIP_INSET + plot} />
      </ChartSvg>
    </FoldingView>
  );
}

/** What the charts show, for screen readers (the views themselves are drawn, not read). */
function chartsDescription(data: ReviewChartData): string {
  const views = ["the winning chances after each move, the reviewed side's from the bottom"];
  if (data.hasDifficulty && data.model !== null)
    views.push("how hard the best move was to find at the rating Maia read it at");
  if (data.hasTimes) views.push("the time each move took");
  return `Charts of ${views.join(", ")}. Marked moves are coloured; ringed ones are the key insights. The left and right arrow keys step through the moves, Home and End go to the start and the end.`;
}

/**
 * The difficulty view's place when the review has no Maia data: Maia 3's download while it isn't
 * installed, else a pointer to analysing the game again with Maia on.
 */
function MaiaPrompt() {
  if (useMaia3Installed() === false)
    return (
      <div style={{ paddingLeft: GUTTER }}>
        <MaiaDownloadPrompt variant="line" />
      </div>
    );
  return (
    <p className="text-2xs text-fg-subtle" style={{ paddingLeft: GUTTER }} data-maia-prompt>
      Difficulty needs Maia: analyze the game again with Maia on.
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
