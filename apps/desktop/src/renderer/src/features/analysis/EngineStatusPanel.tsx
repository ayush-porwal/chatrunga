import { Fragment, memo, useCallback, useMemo, useState } from "react";
import { ChevronDown, Cpu, Lock, Play, RotateCcw, Settings, Square } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { formatScore } from "../game-review/review-score";
import { MoveLink, type GoToLine } from "../game-review/MoveLinks";
import { ReviewBoard } from "../game-review/ReviewBoard";
import { numberedLine, uciLineSteps, uciLineToSan } from "../game-review/review-utils";
import { useGameStore } from "../../stores/game-store";
import type { EngineInfo, EngineScore } from "@chaturanga/shared/types/engine";
import { scoreFromWhitePerspective } from "@chaturanga/shared/chess/review";
import { useAnalysisStore } from "../../stores/analysis-store";
import { selectLiveGameInProgress, useLichessStore } from "../../stores/lichess-store";
import { useEnginesQuery, useSettingsQuery } from "../../queries/api";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { defaultSettings } from "@chaturanga/shared/types/settings";
import { analysisLimitLabel } from "./analysis-engine";
import { Notice } from "@/components/ui/notice";
import { Eyebrow } from "@/components/ui/page";
import { IconButton } from "@/components/ui/icon-button";
import { Stat } from "@/components/ui/stat";
import { cn } from "@/lib/utils";
import { cgWrapPieceSetClass, piecePresentationTailwindClass } from "@chaturanga/shared/types/settings";
import { CgPieceGlyph, type PreviewPieceRole } from "../settings/piece-style-preview";
import { useBoardAppearance } from "../board/useBoardAppearance";

/** As many rows as lines asked for, from the first line on (arriving lines never push content down). */
function linesWithPlaceholders(lines: readonly EngineInfo[], reserved: number): Array<EngineInfo | null> {
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
const FIGURINE_ROLES: Record<string, PreviewPieceRole> = { K: "king", Q: "queen", R: "rook", B: "bishop", N: "knight" };

/** A piece of the board's own set, sized to the text (must sit inside the lines' piece-set wrapper). */
function Figurine({ role }: { role: PreviewPieceRole }) {
  return (
    // The sprites carry their own padding: pulled in so the piece sits against its square (♘f6).
    <span className="relative -mr-[0.14em] -ml-[0.06em] inline-block size-[1.35em] overflow-hidden align-[-0.32em]">
      <CgPieceGlyph color="white" role={role} />
    </span>
  );
}

/** A SAN move with its piece drawn as the board's piece (`♘f3`, `exd5`, `O-O`, `e8=♕`). */
function FigurineSan({ san }: { san: string }) {
  const role = FIGURINE_ROLES[san[0] ?? ""];
  const body = role ? san.slice(1) : san;
  const promotion = /=([QRBN])/.exec(body);
  if (!promotion) {
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
      <Figurine role={FIGURINE_ROLES[promotion[1]!]!} />
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
        "inline-flex h-6 min-w-[3.5rem] items-center justify-center rounded-md px-1.5 font-mono text-xs font-semibold tabular-nums",
        label === null
          ? "bg-surface-raised text-fg-subtle"
          : blackBetter
            ? "border border-line bg-black text-white"
            : "bg-white text-black"
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
 * shows as a dash.
 */
const EngineLineRow = memo(function EngineLineRow({
  index,
  line,
  fen,
  nodeId,
  expanded,
  onToggle,
  onGoToLine,
  onPreview
}: {
  index: number;
  line: EngineInfo | null;
  fen: string;
  nodeId: string;
  expanded: boolean;
  onToggle: (multipv: number) => void;
  onGoToLine?: GoToLine;
  /** A move of this line is hovered or focused (its position shows below the lines). */
  onPreview?: (target: PreviewTarget) => void;
}) {
  const steps = useMemo(() => (line?.pv?.length ? uciLineSteps(fen, line.pv.slice(0, MAX_LINE_MOVES)) : []), [fen, line]);
  const sans = useMemo(() => steps.map((step) => step.san), [steps]);
  const score = line?.score ? whiteScore(line.score, fen) : null;
  const multipv = line?.multipv ?? index + 1;
  return (
    <li
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)_1.75rem] gap-x-2.5 py-1.5 text-[0.8125rem] leading-6",
        expanded ? "items-start" : "min-h-9 items-center"
      )}
    >
      <ScorePill score={score} />
      <span className={cn("min-w-0 text-fg-secondary", expanded ? "whitespace-normal break-words" : "truncate")}>
        {steps.length
          ? steps.map((step, moveIndex) => {
              const number = moveNumberBefore(fen, moveIndex);
              return (
                <Fragment key={`${moveIndex}-${step.san}`}>
                  {moveIndex ? " " : null}
                  {/* A move number never wraps away from its move. */}
                  <span
                    className={number ? "whitespace-nowrap" : undefined}
                    onPointerEnter={() => onPreview?.({ multipv, moveIndex })}
                    onFocus={() => onPreview?.({ multipv, moveIndex })}
                  >
                    {number ? <span className="text-fg-subtle tabular-nums">{number} </span> : null}
                    {onGoToLine ? (
                      <MoveLink
                        san={step.san}
                        nativeTitle={false}
                        className="text-current hover:text-accent"
                        onActivate={() => onGoToLine({ startNodeId: nodeId, moves: sans.slice(0, moveIndex + 1) })}
                      >
                        <FigurineSan san={step.san} />
                      </MoveLink>
                    ) : (
                      // The figurine is decorative: the move is read out as its SAN (Nf6, not f6).
                      <span
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
          icon={<ChevronDown className={cn("transition-transform duration-micro", expanded && "rotate-180")} />}
          size="icon-xs"
          aria-expanded={expanded}
          onClick={() => onToggle(multipv)}
          className={expanded ? "mt-0.5 self-start" : undefined}
        />
      ) : (
        <span />
      )}
    </li>
  );
});

/** The move of an engine line being hovered or focused: the position after it, shown below the lines. */
type LinePreview = { fenAfter: string; uci: string; label: string; score: string | null };
/** Which move is hovered: line (MultiPV number) and move index, so an updated line updates the preview. */
type PreviewTarget = { multipv: number; moveIndex: number };

/** The preview for `target` from the lines as they are now; null once that move is gone. */
function previewFor(fen: string, lines: readonly EngineInfo[], target: PreviewTarget): LinePreview | null {
  const line = lines.find((candidate) => (candidate.multipv ?? 1) === target.multipv);
  if (!line?.pv?.length) return null;
  const steps = uciLineSteps(fen, line.pv.slice(0, MAX_LINE_MOVES));
  const step = steps[target.moveIndex];
  if (!step) return null;
  return {
    fenAfter: step.fenAfter,
    uci: step.uci,
    label: numberedLine(fen, steps.slice(0, target.moveIndex + 1).map((item) => item.san)),
    score: line.score ? formatScore(whiteScore(line.score, fen), 2) : null
  };
}

/**
 * A roomy board under the lines with the position after the move being hovered (or focused), the
 * line up to it and the line's score. Below the lines, it never covers the moves being read.
 */
function LinePreviewCard({ preview }: { preview: LinePreview }) {
  const orientation = useGameStore((state) => state.orientation);
  return (
    <div className="grid animate-fade-in gap-3 rounded-xl border border-line-subtle bg-surface-raised/40 p-3" aria-live="polite">
      <ReviewBoard
        fen={preview.fenAfter}
        orientation={orientation}
        lastMove={[preview.uci.slice(0, 2), preview.uci.slice(2, 4)]}
        className="aspect-square w-full max-w-md justify-self-center"
      />
      <div className="grid gap-1">
        <p className="font-mono text-sm leading-6 text-fg">{preview.label}</p>
        {preview.score ? (
          <p className="text-xs text-fg-muted">
            Line score <span className="font-mono text-fg-secondary">{preview.score}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

const goToLine: GoToLine = (target) => {
  useGameStore.getState().goToLine(target.startNodeId, target.moves);
};

/**
 * Workspace "Engine" tab: live search stats and principal variations (flat — the panel is the card).
 * Locked while a Lichess game is being played: outside help is against Lichess's fair-play rules.
 */
export function EngineStatusPanel(props: {
  onStartAnalysis?: () => void;
  onStopAnalysis?: () => void;
  onOpenSettings?: () => void;
}) {
  const onlineGame = useLichessStore(selectLiveGameInProgress);
  if (onlineGame) {
    return (
      <Notice tone="info" icon={<Lock />} title="Engine off during your Lichess game">
        Lichess doesn’t allow outside help while a game is on. The engine, Maia and the coach are back for the review
        once it ends.
      </Notice>
    );
  }
  return <EngineStatusPanelContent {...props} />;
}

function EngineStatusPanelContent({
  onStartAnalysis,
  onStopAnalysis,
  onOpenSettings
}: {
  /** Starts (or resumes) live analysis: the idle state's button and the header's Start. Omit to hide it. */
  onStartAnalysis?: () => void;
  /** Stops live analysis (its lines stay, and Start carries on from them). */
  onStopAnalysis?: () => void;
  /** Offered when no engine is installed (the way to get one). */
  onOpenSettings?: () => void;
}) {
  // Only what this panel shows (engine info arrives throttled, ~6 updates a second at most).
  const { status, latestInfo, topLines, bestMove, error, activeEngineId } = useAnalysisStore(
    useShallow((state) => ({
      status: state.status,
      latestInfo: state.latestInfo,
      topLines: state.topLines,
      bestMove: state.bestMove,
      error: state.error,
      activeEngineId: state.activeEngineId
    }))
  );
  const fen = useGameStore((state) => state.currentFen);
  const nodeId = useGameStore((state) => state.currentNodeId);
  // During a live engine match lines are read-only (the game store refuses new branches then).
  const linesNavigable = useGameStore((state) => state.mode !== "engine" || !state.engineSide || Boolean(state.gameOutcome));
  // Live analysis (not an engine game's opponent): the engine can be switched from the header.
  const analysing = useGameStore((state) => state.mode === "analysis");
  const settings = useSettingsQuery();
  const analysisSettings = { ...defaultSettings, ...(settings.data ?? {}) };
  const searchLimit = analysisLimitLabel(analysisSettings);
  // An engine game asks for one line; live analysis (running or stopped) for as many as its settings say.
  const engineGame = useGameStore((state) => state.mode === "engine");
  const reservedLines = engineGame ? 1 : analysisSettings.analysisLines;
  // The hovered line move, for the position it was hovered in (a new position drops it). The card
  // reads that line as it is now, so a line the engine updates under the pointer updates too.
  const [hovered, setHovered] = useState<{ fen: string; target: PreviewTarget } | null>(null);
  const setPreview = useCallback((target: PreviewTarget) => setHovered({ fen, target }), [fen]);
  const clearPreview = useCallback(() => setHovered(null), []);
  // Unfolded lines (by MultiPV number): the whole line with move numbers.
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
  const restartFresh = useAnalysisStore((state) => state.restartFresh);
  // A depth- or time-limited search that reached its limit: no search runs (Restart searches again).
  const finished = status === "ready";
  const { appearance } = useBoardAppearance();
  const preview = useMemo(
    () => (hovered && hovered.fen === fen ? previewFor(fen, topLines, hovered.target) : null),
    [hovered, fen, topLines]
  );
  const engines = useEnginesQuery();
  const engineName = engines.data?.find((engine) => engine.id === activeEngineId)?.name ?? null;
  // With MultiPV the latest info can be line 2/3 — read depth/score/best from the principal line.
  const primary = topLines.find((line) => (line.multipv ?? 1) === 1) ?? latestInfo;
  const best = bestMove ?? primary?.pv?.[0] ?? null;
  const bestSan = useMemo(() => (best ? (uciLineToSan(fen, [best])[0] ?? null) : null), [best, fen]);
  const hasData = Boolean(latestInfo || topLines.length || best);
  const idle = status === "idle" || status === "error";
  // Nothing to analyse with: say so and point to Settings instead of an error with no way out.
  // Any usable engine can analyse (Maia too, when it's the only one installed).
  const noEngines = engines.isSuccess && !engines.data.some((engine) => engine.isAvailable);

  return (
    <section className="grid content-start gap-4">
      {hasData || !idle ? (
        // The tab above already says "Engine": the header names the engine, how far it searches,
        // and holds the controls (Stop / Start, and Restart from scratch).
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="grid min-w-0 gap-0.5">
            <h3 className="truncate text-base font-semibold text-fg">{engineName ?? "Engine"}</h3>
            <p className="truncate text-xs text-fg-muted">
              {status === "error"
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
                    : "Stopped"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {analysing ? (
              <>
                <IconButton
                  label={finished ? "Search again from scratch" : "Restart analysis from scratch"}
                  icon={<RotateCcw />}
                  onClick={restartFresh}
                />
                {onStopAnalysis ? (
                  <Button type="button" variant="outline" size="sm" onClick={onStopAnalysis}>
                    <Square />
                    Stop
                  </Button>
                ) : null}
              </>
            ) : onStartAnalysis ? (
              <Button type="button" variant="primary" size="sm" onClick={onStartAnalysis}>
                <Play />
                Start
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {hasData ? (
        <>
          {/* Evenly across the panel: Depth on the left edge, Score centred, Best on the right edge. */}
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Depth" value={primary?.depth ?? "–"} mono />
            <Stat label="Score" value={primary?.score ? formatScore(whiteScore(primary.score, fen), 2) : "–"} mono className="justify-items-center text-center" />
            <Stat label="Best" value={bestSan ?? "–"} mono className="justify-items-end text-right" />
          </div>
          {topLines.length ? (
            <div className="grid gap-1">
              <Eyebrow>Lines</Eyebrow>
              {/* Rows are reserved up to the MultiPV count so lines arriving never push content down. */}
              {/* The board's piece set, so the lines' figurines are the board's pieces. */}
              <ol
                className={cn("cg-wrap divide-y divide-line-subtle", cgWrapPieceSetClass(appearance.pieceStyle), piecePresentationTailwindClass(appearance.piecePresentation))}
                // Unlayered `.cg-wrap` rules (board.css inline-size containment) would size this list.
                style={{ display: "block", containerType: "normal" }}
                onPointerLeave={clearPreview}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) clearPreview();
                }}
              >
                {linesWithPlaceholders(topLines, reservedLines).map((line, index) => (
                  <EngineLineRow
                    key={line?.multipv ?? `empty-${index}`}
                    index={index}
                    line={line}
                    fen={fen}
                    nodeId={nodeId}
                    expanded={expandedLines.has(line?.multipv ?? index + 1)}
                    onToggle={toggleLine}
                    onGoToLine={linesNavigable ? goToLine : undefined}
                    onPreview={setPreview}
                  />
                ))}
              </ol>
              {preview ? <LinePreviewCard preview={preview} /> : null}
            </div>
          ) : null}
        </>
      ) : idle && noEngines ? (
        <EmptyState
          icon={<Cpu />}
          title="No engine installed"
          description="Download Stockfish or add a UCI engine you already have."
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
      ) : idle ? (
        <EmptyState
          icon={<Cpu />}
          title="Engine is idle"
          description={onStartAnalysis ? "Analyze the current position." : undefined}
          action={
            onStartAnalysis ? (
              <Button type="button" variant="primary" size="sm" onClick={onStartAnalysis}>
                <Play />
                Start analysis
              </Button>
            ) : undefined
          }
          className="py-6"
        />
      ) : (
        <EmptyState
          compact
          title={status === "starting" ? "Starting engine…" : status === "thinking" ? "Thinking…" : "No analysis yet."}
        />
      )}
      {error && !(idle && noEngines) ? <Notice tone="danger">{error}</Notice> : null}
    </section>
  );
}
