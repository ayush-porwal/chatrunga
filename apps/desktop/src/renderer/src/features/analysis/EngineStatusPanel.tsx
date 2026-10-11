import { engineDisplayName } from "@chaturanga/shared/engine/managed";
import { Fragment, memo, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, CircleAlert, Cpu, Download, Lock, RotateCcw, Settings } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { formatScore } from "../game-review/review-score";
import { MoveLink, type GoToLine } from "../game-review/MoveLinks";
import { ReviewBoard } from "../game-review/ReviewBoard";
import { numberedLine, uciLineSteps, uciLineToSan } from "../game-review/review-utils";
import { useGameStore } from "../../stores/game-store";
import type { Color } from "@chaturanga/shared/types/chess";
import type { EngineInfo, EngineScore } from "@chaturanga/shared/types/engine";
import { scoreFromWhitePerspective } from "@chaturanga/shared/chess/review";
import { useAnalysisStore } from "../../stores/analysis-store";
import { selectLiveGameInProgress, useLichessStore } from "../../stores/lichess-store";
import { useEnginesQuery, useSettingsQuery } from "../../queries/api";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  defaultSettings,
  cgWrapPieceSetClass,
  pieceSizesClass
} from "@chaturanga/shared/types/settings";
import { analysisEngineFor, analysisLimitLabel } from "./analysis-engine";
import { onPausedPosition, pausedStatusLabel, type PausedAnalysis } from "./live-analysis";
import { EngineAvatar } from "./EngineAvatar";
import { Notice } from "@/components/ui/notice";
import { IconButton } from "@/components/ui/icon-button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { PreviewPieceRole } from "../settings/piece-style-preview";
import { Figurine } from "../board/Figurine";
import { useBoardAppearance } from "../board/useBoardAppearance";
import { ENGINE_LINE_PREVIEW } from "../game/move-list-model";
import { usePreviewBoardSize } from "../game/usePreviewBoardSize";

/** As many rows as lines asked for, from the first line on (arriving lines never push content down). */
function linesWithPlaceholders(
  lines: readonly EngineInfo[],
  reserved: number
): Array<EngineInfo | null> {
  const shown: Array<EngineInfo | null> = lines.slice(0, Math.max(reserved, 1));
  while (shown.length < reserved) shown.push(null);
  return shown;
}

/** The most moves of a line shown (and searched for previews) when it's unfolded. */
const MAX_LINE_MOVES = 60;

/** `12.` before White's moves, `12…` before Black's first one, nothing before Black's others. */
function moveNumberBefore(fen: string, index: number): string | null {
  const [, turn = "w", , , , fullmove = "1"] = fen.split(" ");
  const whiteFirst = turn === "w";
  const whiteMoves = whiteFirst ? index % 2 === 0 : index % 2 === 1;
  const number = (Number(fullmove) || 1) + Math.floor((index + (whiteFirst ? 0 : 1)) / 2);
  if (whiteMoves) return `${number}.`;
  return index === 0 ? `${number}…` : null;
}

/** SAN piece letters → the board's piece (figurine notation, as Lichess shows lines). */
const FIGURINE_ROLES: Partial<Record<string, PreviewPieceRole>> = {
  K: "king",
  Q: "queen",
  R: "rook",
  B: "bishop",
  N: "knight"
};

/** A SAN move with its piece drawn as the board's piece (`♘f3`, `exd5`, `O-O`, `e8=♕`). */
function FigurineSan({ san }: { san: string }) {
  const role = FIGURINE_ROLES[san.charAt(0)];
  const body = role ? san.slice(1) : san;
  const promotion = /=([QRBN])/.exec(body);
  const promoted = promotion ? FIGURINE_ROLES[promotion[1]] : undefined;
  if (!promotion || !promoted) {
    return (
      <>
        {role ? <Figurine role={role} /> : null}
        {body}
      </>
    );
  }
  return (
    <>
      {role ? <Figurine role={role} /> : null}
      {body.slice(0, promotion.index + 1)}
      <Figurine role={promoted} />
      {body.slice(promotion.index + 2)}
    </>
  );
}

/** An engine score (from the side to move, as UCI reports it) from White's side, as the bar and Lichess show it. */
function whiteScore(score: EngineScore, fen: string): EngineScore {
  return scoreFromWhitePerspective(score, fen.split(" ")[1] === "b" ? "black" : "white");
}

/** The line's score (White's side) as a pill: light while White is better, dark while Black is (like the bar). */
function ScorePill({ score }: { score: EngineScore | null }) {
  const blackBetter = Boolean(score && score.value < 0);
  const label = score ? formatScore(score, 2) : null;
  return (
    <span
      className={cn(
        "inline-flex h-6 min-w-14 items-center justify-center rounded-md px-2 font-mono text-[0.78125rem] font-semibold tabular-nums",
        label === null
          ? "bg-control text-fg-subtle"
          : blackBetter
            ? "bg-side-black text-fg inset-ring inset-ring-line-strong"
            : "bg-piece-white text-side-white-fg"
      )}
    >
      {label ?? "–"}
    </span>
  );
}

/**
 * One principal variation, as Lichess shows them: the score as a pill, then the line in SAN with
 * move numbers and figurines — on one row (truncated, no reflow as it updates), or unfolded (the
 * chevron) to the whole line. Each move jumps the board there when `onGoToLine` is set, and
 * hovering one shows its position below the lines. A line that doesn't fit the position yet
 * shows as a dash. In the Moves tab's engine block (not `compact`) the row lights up under the
 * pointer and the line's first move stands out.
 */
const EngineLineRow = memo(function EngineLineRow({
  index,
  line,
  fen,
  nodeId,
  expanded,
  compact,
  onToggle,
  onGoToLine,
  goToLineLabel,
  onPreview
}: {
  index: number;
  line: EngineInfo | null;
  fen: string;
  nodeId: string;
  expanded: boolean;
  /** Study's tighter row (see EngineAnalysisPanel). */
  compact: boolean;
  onToggle: (multipv: number) => void;
  onGoToLine?: GoToLine;
  goToLineLabel?: (san: string) => string;
  /** A move of this line is hovered or focused (its position shows below the lines). */
  onPreview?: (target: PreviewTarget) => void;
}) {
  const steps = useMemo(
    () => (line?.pv?.length ? uciLineSteps(fen, line.pv.slice(0, MAX_LINE_MOVES)) : []),
    [fen, line]
  );
  const sans = useMemo(() => steps.map((step) => step.san), [steps]);
  const score = line?.score ? whiteScore(line.score, fen) : null;
  const multipv = line?.multipv ?? index + 1;
  return (
    <li
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)_1.75rem] gap-x-2.5 text-[0.8125rem] leading-6",
        compact
          ? "py-1"
          : "group/line rounded-lg py-1 pr-1 pl-1.5 transition-colors duration-micro hover:bg-control",
        expanded ? "items-start" : compact ? "min-h-8 items-center" : "min-h-8.5 items-center"
      )}
    >
      <ScorePill score={score} />
      <span
        className={cn(
          "min-w-0 text-fg-secondary",
          expanded ? "whitespace-normal break-words" : "truncate"
        )}
      >
        {steps.length
          ? steps.map((step, moveIndex) => {
              const number = moveNumberBefore(fen, moveIndex);
              return (
                <Fragment key={`${moveIndex}-${step.san}`}>
                  {moveIndex ? " " : null}
                  {/* A move number never wraps away from its move. */}
                  <span
                    className={cn(
                      number && "whitespace-nowrap",
                      !compact && moveIndex === 0 && "font-semibold text-fg"
                    )}
                    onPointerEnter={() => onPreview?.({ multipv, moveIndex })}
                    onFocus={() => onPreview?.({ multipv, moveIndex })}
                  >
                    {number ? <span className="text-fg-subtle tabular-nums">{number} </span> : null}
                    {onGoToLine ? (
                      <MoveLink
                        san={step.san}
                        nativeTitle={false}
                        label={goToLineLabel?.(step.san)}
                        className="text-current hover:text-accent"
                        onActivate={() =>
                          onGoToLine({ startNodeId: nodeId, moves: sans.slice(0, moveIndex + 1) })
                        }
                      >
                        <FigurineSan san={step.san} />
                      </MoveLink>
                    ) : (
                      // The figurine is decorative: the move is read out as its SAN (Nf6, not f6).
                      <span
                        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a move that isn't a link is still reachable by keyboard, read out as its SAN
                        tabIndex={0}
                        aria-label={step.san}
                        className="rounded-[3px] outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50"
                      >
                        <FigurineSan san={step.san} />
                      </span>
                    )}
                  </span>
                </Fragment>
              );
            })
          : "–"}
      </span>
      {steps.length > 1 ? (
        <IconButton
          label={expanded ? "Fold the line" : "Show the whole line"}
          icon={
            <ChevronDown
              className={cn("transition-transform duration-micro", expanded && "rotate-180")}
            />
          }
          size="icon-xs"
          aria-expanded={expanded}
          onClick={() => onToggle(multipv)}
          className={cn(
            expanded && "mt-0.5 self-start",
            // Dimmed until the row is hovered (it always keeps its place).
            !compact && "opacity-60 group-hover/line:opacity-100 focus-visible:opacity-100"
          )}
        />
      ) : (
        <span />
      )}
    </li>
  );
});

/** The move of an engine line being hovered or focused: the position after it, shown below the lines. */
type LinePreview = { fenAfter: string; uci: string; label: string };
/** Which move is hovered: line (MultiPV number) and move index, so an updated line updates the preview. */
type PreviewTarget = { multipv: number; moveIndex: number };

/** The preview for `target` from the lines as they are now; null once that move is gone. */
function previewFor(
  fen: string,
  lines: readonly EngineInfo[],
  target: PreviewTarget
): LinePreview | null {
  const line = lines.find((candidate) => (candidate.multipv ?? 1) === target.multipv);
  if (!line?.pv?.length) return null;
  const steps = uciLineSteps(fen, line.pv.slice(0, MAX_LINE_MOVES));
  const step = steps.at(target.moveIndex);
  if (!step) return null;
  return {
    fenAfter: step.fenAfter,
    uci: step.uci,
    label: numberedLine(
      fen,
      steps.slice(0, target.moveIndex + 1).map((item) => item.san)
    )
  };
}

/**
 * A roomy board under the lines with the position after the move being hovered (or focused): just
 * the board, since the line is read above it (its move highlighted there). Below the lines, it
 * never covers the moves being read. Compact, see FloatingLinePreview.
 */
function LinePreviewCard({
  preview,
  orientation,
  compact
}: {
  preview: LinePreview;
  orientation: Color;
  compact: boolean;
}) {
  // Under the lines it keeps an engine line preview's bounds (about three quarters of a BEST
  // line's), so a wide panel never shows a board that crowds the lines and the moves out; the
  // floating (compact) one has its own width.
  const slotRef = useRef<HTMLDivElement>(null);
  const size = usePreviewBoardSize(slotRef, ENGINE_LINE_PREVIEW);
  return (
    // Named only for assistive tech: the line is read above it.
    <div
      ref={slotRef}
      role="group"
      aria-label={`Position after ${preview.label}`}
      className={cn("grid animate-fade-in", compact && "rounded-md shadow-popover")}
    >
      <div
        className={cn("w-full justify-self-center", compact && "max-w-48")}
        style={
          compact
            ? undefined
            : {
                maxWidth: size ?? ENGINE_LINE_PREVIEW.min,
                visibility: size === null ? "hidden" : undefined
              }
        }
      >
        <ReviewBoard
          fen={preview.fenAfter}
          orientation={orientation}
          lastMove={[preview.uci.slice(0, 2), preview.uci.slice(2, 4)]}
          className="aspect-square w-full"
        />
      </div>
    </div>
  );
}

/** The floating preview's width (its 192px board) and its gap from the panel. */
const FLOATING_PREVIEW_WIDTH = 192;
const FLOATING_PREVIEW_GAP = 20;

/**
 * The compact panel's preview (Study): beside the side panel, over the board's edge, level with
 * the lines, like a tooltip of the hovered move. Never in the panel, where it would grow it or
 * cover the moves and the edit buttons under it. In a portal: the panel clips its content and is
 * a containing block for fixed boxes.
 */
function FloatingLinePreview({
  anchor,
  preview,
  orientation
}: {
  /** The lines' list, which it is placed beside. */
  anchor: HTMLElement;
  preview: LinePreview;
  orientation: Color;
}) {
  const box = anchor.getBoundingClientRect();
  const panelLeft = anchor.closest("aside")?.getBoundingClientRect().left ?? box.left;
  return createPortal(
    <div
      className="fixed z-50"
      style={{
        top: Math.max(8, Math.min(box.top, window.innerHeight - FLOATING_PREVIEW_WIDTH - 8)),
        left: Math.max(8, panelLeft - FLOATING_PREVIEW_GAP - FLOATING_PREVIEW_WIDTH),
        width: FLOATING_PREVIEW_WIDTH
      }}
    >
      <LinePreviewCard preview={preview} orientation={orientation} compact />
    </div>,
    document.body
  );
}

const goToLine: GoToLine = (target) => {
  useGameStore.getState().goToLine(target.startNodeId, target.moves);
};

/** The position an engine panel's lines belong to, and what the panel may do with them. */
export type EnginePanelPosition = {
  fen: string;
  /** The node the lines start from (a picked move is a line from here). */
  nodeId: string;
  /** The way the line preview's board faces. */
  orientation: Color;
  /** Live analysis runs (not an engine game's opponent): Restart is offered. */
  analysing: boolean;
  /** An engine game's opponent: its one line is shown. */
  engineGame: boolean;
  /** A move of a line was picked: the line up to it, from `nodeId`. Unset, the moves only show. */
  onGoToLine?: GoToLine;
  /** What picking a move does, for assistive tech (default: going to its position). */
  goToLineLabel?: (san: string) => string;
};

/** The game board's position for the Moves tab's engine: picking a line's move walks the board there. */
function useBoardEnginePosition(): EnginePanelPosition {
  const fen = useGameStore((state) => state.currentFen);
  const nodeId = useGameStore((state) => state.currentNodeId);
  const orientation = useGameStore((state) => state.orientation);
  // During a live engine match lines are read-only (the game store refuses new branches then).
  const linesNavigable = useGameStore(
    (state) => state.mode !== "engine" || !state.engineSide || Boolean(state.gameOutcome)
  );
  // Live analysis (not an engine game's opponent): the engine can be switched from the header.
  const analysing = useGameStore((state) => state.mode === "analysis");
  const engineGame = useGameStore((state) => state.mode === "engine");
  return useMemo(
    () => ({
      fen,
      nodeId,
      orientation,
      analysing,
      engineGame,
      onGoToLine: linesNavigable ? goToLine : undefined
    }),
    [fen, nodeId, orientation, analysing, engineGame, linesNavigable]
  );
}

/** How Study fits the engine panel in beside its moves (see StudyEnginePanel). */
type EnginePanelLayout = {
  /** Offered when no engine is installed (the way to get one). */
  onOpenSettings?: () => void;
  /** A control at the end of the header (e.g. Close); the header then always shows. */
  headerAction?: ReactNode;
  /** One line above the lines saying what picking a move does. */
  linesHint?: ReactNode;
};

/** Only what an engine panel shows of the analysis (engine info arrives throttled, ~6 updates a second at most). */
function useEngineReadout() {
  return useAnalysisStore(
    useShallow((state) => ({
      status: state.status,
      latestInfo: state.latestInfo,
      topLines: state.topLines,
      bestMove: state.bestMove,
      error: state.error,
      activeEngineId: state.activeEngineId
    }))
  );
}

/** The principal line (with MultiPV the latest info can be line 2/3) and its best move in SAN. */
function usePrincipalLine(
  fen: string,
  readout: Pick<ReturnType<typeof useEngineReadout>, "topLines" | "latestInfo" | "bestMove">
) {
  const { topLines, latestInfo, bestMove } = readout;
  const primary = topLines.find((line) => (line.multipv ?? 1) === 1) ?? latestInfo;
  const best = bestMove ?? primary?.pv?.[0] ?? null;
  const bestSan = useMemo(
    () => (best ? (uciLineToSan(fen, [best])[0] ?? null) : null),
    [best, fen]
  );
  return { primary, best, bestSan };
}

/**
 * The lines' hover and fold state: the hovered line move, for the position it was hovered in (a
 * new position drops it; the card reads that line as it is now, so a line the engine updates under
 * the pointer updates too), and the unfolded lines (by MultiPV number). Held by the panel, so the
 * lines coming and going with the search keep them.
 */
function useLineInteractions(fen: string) {
  const [hovered, setHovered] = useState<{ fen: string; target: PreviewTarget } | null>(null);
  const setPreview = useCallback((target: PreviewTarget) => setHovered({ fen, target }), [fen]);
  const clearPreview = useCallback(() => setHovered(null), []);
  const [expandedLines, setExpandedLines] = useState<ReadonlySet<number>>(() => new Set());
  const toggleLine = useCallback(
    (multipv: number) =>
      setExpandedLines((current) => {
        const next = new Set(current);
        if (!next.delete(multipv)) next.add(multipv);
        return next;
      }),
    []
  );
  return { hovered, setPreview, clearPreview, expandedLines, toggleLine };
}

/**
 * The engine's lines, as many rows as asked for (arriving lines never push content down), and the
 * hovered move's preview: under the lines, or (compact) floating beside the panel.
 */
function EngineLines({
  position,
  lines,
  reserved,
  compact,
  interactions
}: {
  position: EnginePanelPosition;
  lines: readonly EngineInfo[];
  reserved: number;
  compact: boolean;
  interactions: ReturnType<typeof useLineInteractions>;
}) {
  const { fen, nodeId, orientation, onGoToLine, goToLineLabel } = position;
  const { hovered, setPreview, clearPreview, expandedLines, toggleLine } = interactions;
  /** The lines' list, which a compact panel's floating preview is placed beside. */
  const [linesList, setLinesList] = useState<HTMLOListElement | null>(null);
  const pieceSet = usePieceSetClass();
  const preview = useMemo(
    () => (hovered && hovered.fen === fen ? previewFor(fen, lines, hovered.target) : null),
    [hovered, fen, lines]
  );
  return (
    <>
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- leaving the list (pointer or focus) ends the move preview */}
      <ol
        ref={setLinesList}
        // The board's piece set, so the lines' figurines are the board's pieces.
        className={cn(pieceSet, compact && "divide-y divide-line-subtle")}
        style={FIGURINE_BLOCK_STYLE}
        onPointerLeave={clearPreview}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) clearPreview();
        }}
      >
        {linesWithPlaceholders(lines, reserved).map((line, index) => (
          <EngineLineRow
            key={line?.multipv ?? `empty-${index}`}
            index={index}
            line={line}
            fen={fen}
            nodeId={nodeId}
            expanded={expandedLines.has(line?.multipv ?? index + 1)}
            compact={compact}
            onToggle={toggleLine}
            onGoToLine={onGoToLine}
            goToLineLabel={goToLineLabel}
            onPreview={setPreview}
          />
        ))}
      </ol>
      {preview && compact && linesList ? (
        <FloatingLinePreview anchor={linesList} preview={preview} orientation={orientation} />
      ) : preview && !compact ? (
        <LinePreviewCard preview={preview} orientation={orientation} compact={false} />
      ) : null}
    </>
  );
}

/** The board's piece set around figurines (`.cg-wrap` and its piece-set classes). */
function usePieceSetClass(): string {
  const { appearance } = useBoardAppearance();
  return cn(
    "cg-wrap",
    cgWrapPieceSetClass(appearance.pieceStyle),
    pieceSizesClass(appearance.pieceSizes)
  );
}
/** Unlayered `.cg-wrap` rules (board.css inline-size containment) would size a figurine block. */
const FIGURINE_BLOCK_STYLE = { display: "block", containerType: "normal" } as const;

/**
 * Study's engine panel: one row of header with the depth in it, the lines (no Depth / Score /
 * Best row: the first line's score and move say them) and the hovered move's preview floating
 * beside the side panel. Locked while a Lichess game is being played (outside help is against
 * Lichess's fair-play rules).
 */
export function EngineAnalysisPanel(props: EnginePanelLayout & { position: EnginePanelPosition }) {
  const onlineGame = useLichessStore(selectLiveGameInProgress);
  if (onlineGame) {
    return (
      <Notice tone="info" icon={<Lock />} title={LICHESS_LOCK_TITLE}>
        {LICHESS_LOCK_TEXT}
      </Notice>
    );
  }
  return <EngineStatusPanelContent {...props} />;
}

const LICHESS_LOCK_TITLE = "Engine off during your Lichess game";
const LICHESS_LOCK_TEXT =
  "Lichess doesn’t allow outside help while a game is on. The engine, Maia and the coach are back for the review once it ends.";
const NO_ENGINE_TITLE = "No engine installed";
const NO_ENGINE_TEXT = "Download Stockfish or add a UCI engine you already have.";

function EngineStatusPanelContent({
  position,
  onOpenSettings,
  headerAction,
  linesHint
}: EnginePanelLayout & { position: EnginePanelPosition }) {
  const readout = useEngineReadout();
  const { status, latestInfo, topLines, error, activeEngineId } = readout;
  const { fen, analysing, engineGame } = position;
  const settings = useSettingsQuery();
  const analysisSettings = { ...defaultSettings, ...settings.data };
  const searchLimit = analysisLimitLabel(analysisSettings);
  // An engine game asks for one line; live analysis (running or stopped) for as many as its settings say.
  const reservedLines = engineGame ? 1 : analysisSettings.analysisLines;
  const interactions = useLineInteractions(fen);
  const restartFresh = useAnalysisStore((state) => state.restartFresh);
  // A depth- or time-limited search that reached its limit: no search runs (Restart searches again).
  const finished = status === "ready";
  const engines = useEnginesQuery();
  const activeEngine = engines.data?.find((engine) => engine.id === activeEngineId);
  const engineName = activeEngine ? engineDisplayName(activeEngine.name) : null;
  const { primary, best } = usePrincipalLine(fen, readout);
  const hasData = Boolean(latestInfo || topLines.length || best);
  const idle = status === "idle" || status === "error";
  // Nothing to analyse with: say so and point to Settings instead of an error with no way out.
  // Any usable engine can analyse (Maia too, when it's the only one installed).
  const noEngines = engines.isSuccess && !engines.data.some((engine) => engine.isAvailable);
  const statusLabel =
    status === "error"
      ? "The engine stopped with an error"
      : analysing && finished
        ? `Finished at depth ${primary?.depth ?? "–"}`
        : analysing
          ? searchLimit
            ? `Analysing to ${searchLimit}`
            : "Analysing until stopped"
          : status === "starting"
            ? "Starting…"
            : status === "thinking"
              ? "Thinking…"
              : "Stopped";
  // The depth reached while searching (there's no Depth stat), else the status.
  const compactStatus =
    analysing && !finished && status !== "error" && primary?.depth
      ? `Depth ${primary.depth}`
      : statusLabel;

  return (
    <section className="grid content-start gap-2">
      {hasData || !idle || headerAction ? (
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-baseline gap-2">
            <h3 className="truncate text-sm font-semibold text-fg">{engineName ?? "Engine"}</h3>
            <p className="truncate text-xs text-fg-muted" title={statusLabel}>
              {compactStatus}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {/* An engine that stopped with an error runs no search: Restart is the way on. */}
            {analysing ? (
              <IconButton
                label={finished ? "Search again from scratch" : "Restart analysis from scratch"}
                icon={<RotateCcw />}
                onClick={restartFresh}
              />
            ) : null}
            {headerAction}
          </div>
        </div>
      ) : null}
      {hasData ? (
        topLines.length ? (
          <div className="grid gap-1">
            {linesHint ? <p className="text-xs text-fg-muted">{linesHint}</p> : null}
            {/* Rows are reserved up to the MultiPV count so lines arriving never push content down. */}
            <EngineLines
              position={position}
              lines={topLines}
              reserved={reservedLines}
              compact
              interactions={interactions}
            />
          </div>
        ) : null
      ) : idle && noEngines ? (
        <EmptyState
          icon={<Cpu />}
          title={NO_ENGINE_TITLE}
          description={NO_ENGINE_TEXT}
          action={
            onOpenSettings ? (
              <Button type="button" variant="primary" size="sm" onClick={onOpenSettings}>
                <Settings />
                Open Settings
              </Button>
            ) : undefined
          }
          className="py-6"
        />
      ) : idle ? null : (
        <EmptyState
          compact
          title={
            status === "starting"
              ? "Starting engine…"
              : status === "thinking"
                ? "Thinking…"
                : "No analysis yet."
          }
        />
      )}
      {error && !(idle && noEngines) ? <Notice tone="danger">{error}</Notice> : null}
    </section>
  );
}

/**
 * The Moves tab's engine block, fixed above the move tree: the engine row (its image, name and
 * status, Restart and the Analysis switch: live analysis on and off, the only Start / Stop for the
 * board's engine), then while it's on the Depth / Score / Best strip and the lines. Switched off
 * with lines found, it's paused: they stay as they were. Off, only the row shows, so the tree gets
 * the space. With no engine installed, or during a Lichess game, one compact row says so in the
 * engine row's place.
 */
export function EngineStatusPanel({
  onOpenSettings,
  onStartAnalysis,
  onStopAnalysis
}: {
  onOpenSettings?: () => void;
  onStartAnalysis?: () => void;
  onStopAnalysis?: () => void;
}) {
  const onlineGame = useLichessStore(selectLiveGameInProgress);
  const engines = useEnginesQuery();
  const noEngines = engines.isSuccess && !engines.data.some((engine) => engine.isAvailable);
  return (
    <section
      aria-label="Engine"
      className="grid shrink-0 grid-cols-[minmax(0,1fr)] gap-2.5 border-b border-line-subtle px-3 pt-3 pb-2.5"
    >
      {onlineGame ? (
        <EngineNoticeRow tile={<Lock />} title={LICHESS_LOCK_TITLE} text={LICHESS_LOCK_TEXT} />
      ) : noEngines ? (
        <EngineNoticeRow
          tile={<Download />}
          dashed
          title={NO_ENGINE_TITLE}
          text={NO_ENGINE_TEXT}
          action={
            onOpenSettings ? (
              <Button type="button" variant="primary" size="sm" onClick={onOpenSettings}>
                <Settings />
                Open Settings
              </Button>
            ) : null
          }
        />
      ) : (
        <BoardEngine onStartAnalysis={onStartAnalysis} onStopAnalysis={onStopAnalysis} />
      )}
    </section>
  );
}

/** A compact row in the engine row's place: a tile, a title and the sentence saying why, and an action. */
function EngineNoticeRow({
  tile,
  dashed = false,
  title,
  text,
  action = null
}: {
  tile: ReactNode;
  /** An empty slot (nothing installed) rather than a filled tile. */
  dashed?: boolean;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span
        aria-hidden="true"
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-[10px] text-fg-muted [&_svg]:size-4.5",
          dashed ? "border-[1.5px] border-dashed border-line-strong" : "bg-control"
        )}
      >
        {tile}
      </span>
      <div className="grid min-w-0 flex-1 gap-px">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        <p className="text-xs leading-[1.4] text-fg-subtle">{text}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/**
 * The position the engine block's lines belong to: the board's, or while paused the paused one
 * (the board may have moved on since): their moves, previews and picks are read from there.
 */
function useLinesPosition(
  board: EnginePanelPosition,
  paused: PausedAnalysis | null
): EnginePanelPosition {
  return useMemo(
    () => (paused ? { ...board, fen: paused.fen, nodeId: paused.nodeId } : board),
    [board, paused]
  );
}

/** The board's engine row and, while it runs or is paused, its stats and lines. */
function BoardEngine({
  onStartAnalysis,
  onStopAnalysis
}: {
  onStartAnalysis?: () => void;
  onStopAnalysis?: () => void;
}) {
  const board = useBoardEnginePosition();
  const readout = useEngineReadout();
  const { status, topLines, error, activeEngineId } = readout;
  const { analysing, engineGame } = board;
  // Switched off with lines found: they stay, frozen (see the analysis store's paused).
  const paused = useAnalysisStore((state) => (analysing || engineGame ? null : state.paused));
  const position = useLinesPosition(board, paused);
  const { fen } = position;
  const settings = useSettingsQuery();
  const analysisSettings = { ...defaultSettings, ...settings.data };
  const engines = useEnginesQuery();
  // Off, the engine the switch would start; on, paused (or in an engine game), the one searching.
  const engineId =
    ((analysing || engineGame || paused) && activeEngineId) ||
    analysisEngineFor(engines.data, analysisSettings.analysisEngineId);
  const engine = engines.data?.find((item) => item.id === engineId);
  const restartFresh = useAnalysisStore((state) => state.restartFresh);
  const interactions = useLineInteractions(fen);
  const pieceSet = usePieceSetClass();
  const { primary, bestSan } = usePrincipalLine(fen, readout);
  // A depth- or time-limited search that reached its limit: no search runs (Restart searches again).
  const finished = status === "ready";
  const failed = status === "error";
  // The switch is off with nothing paused and no engine game holds the engine: only the row shows.
  const off = !analysing && !engineGame && !paused;
  // An engine game asks for one line; live analysis for as many as its settings say.
  const reservedLines = engineGame ? 1 : analysisSettings.analysisLines;
  const depthTarget =
    (analysing || paused) && analysisSettings.analysisLimit === "depth"
      ? analysisSettings.analysisDepth
      : null;
  const score = primary?.score ? formatScore(whiteScore(primary.score, fen), 2) : "–";
  // Restart while paused searches the board's position from scratch, analysis on again. Both
  // store updates land before the engine driver's next sync (it runs once, after the current
  // task), so it starts one fresh search whatever their order.
  const restart = analysing
    ? restartFresh
    : paused && onStartAnalysis
      ? () => {
          onStartAnalysis();
          restartFresh();
        }
      : null;

  return (
    <>
      <div className="flex min-w-0 items-center gap-3">
        <EngineAvatar imagePath={engine?.imagePath} size="lg" />
        <div className="grid min-w-0 flex-1 gap-px">
          <h3 className="truncate text-[0.9375rem] font-semibold text-fg">
            {engine ? engineDisplayName(engine.name) : "Engine"}
          </h3>
          <p
            className={cn(
              "flex min-w-0 items-center gap-1.5 text-xs",
              failed ? "text-danger" : "text-fg-subtle"
            )}
          >
            {failed ? (
              <>
                <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">The engine stopped with an error</span>
              </>
            ) : paused ? (
              pausedStatusLabel(
                paused,
                onPausedPosition(paused, { currentNodeId: board.nodeId, currentFen: board.fen }),
                primary?.depth
              )
            ) : off ? (
              "Off"
            ) : analysing && finished ? (
              `Finished at depth ${primary?.depth ?? "–"}`
            ) : analysing ? (
              <>
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rounded-full bg-accent shadow-[0_0_0_3px_rgb(143_182_111/0.2)] motion-safe:animate-pulse"
                />
                Analysing
              </>
            ) : status === "starting" ? (
              "Starting…"
            ) : status === "thinking" ? (
              "Thinking…"
            ) : (
              "Stopped"
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* An engine that stopped with an error runs no search: Restart is the way on. */}
          {restart ? (
            <IconButton
              label={finished ? "Search again from scratch" : "Restart analysis from scratch"}
              icon={<RotateCcw />}
              size="icon-xs"
              onClick={restart}
            />
          ) : null}
          <AnalysisSwitch onStart={onStartAnalysis} onStop={onStopAnalysis} />
        </div>
      </div>
      {error ? (
        <Notice tone="danger" title="The engine stopped with an error">
          {error}
        </Notice>
      ) : null}
      {off ? null : (
        <div className={cn("grid gap-2.5", failed && "opacity-45")}>
          {/* The board's piece set, so the best move's figurine is the board's piece. */}
          <dl
            className={cn(
              "grid grid-cols-3 rounded-[10px] border border-line bg-surface-sunken",
              pieceSet
            )}
            style={FIGURINE_GRID_STYLE}
          >
            <StatCell label="Depth">
              {primary?.depth ?? "–"}
              {depthTarget ? (
                <span className="ml-0.5 text-xs font-medium text-fg-subtle">/{depthTarget}</span>
              ) : null}
            </StatCell>
            <StatCell label="Score">{score}</StatCell>
            <StatCell label="Best">
              {bestSan ? (
                // Read out (and found) as its SAN; the figurine is decorative.
                <>
                  <span className="sr-only">{bestSan}</span>
                  <span aria-hidden="true">
                    <FigurineSan san={bestSan} />
                  </span>
                </>
              ) : (
                "–"
              )}
            </StatCell>
          </dl>
          <EngineLines
            position={position}
            lines={topLines}
            reserved={reservedLines}
            compact={false}
            interactions={interactions}
          />
        </div>
      )}
    </>
  );
}
const FIGURINE_GRID_STYLE = { display: "grid", containerType: "normal" } as const;

/** One cell of the engine's Depth / Score / Best strip. */
function StatCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-0.5 px-3 py-2.5 [&+&]:border-l [&+&]:border-line-subtle">
      <dt className="text-2xs text-fg-subtle">{label}</dt>
      <dd className="truncate font-mono text-[1.0625rem] leading-tight font-semibold text-fg tabular-nums">
        {children}
      </dd>
    </div>
  );
}

/**
 * The Analysis switch: on while live analysis runs (the game store's analysis mode, which the
 * engine driver searches), so it always says what the engine is doing. Disabled while the board
 * can't be analysed (a game being played, a finished position).
 */
function AnalysisSwitch({ onStart, onStop }: { onStart?: () => void; onStop?: () => void }) {
  const on = useGameStore((state) => state.mode === "analysis");
  return (
    <Switch
      checked={on}
      disabled={on ? !onStop : !onStart}
      aria-label="Analysis"
      onCheckedChange={(next) => (next ? onStart?.() : onStop?.())}
    />
  );
}
