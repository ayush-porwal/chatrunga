import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpen, Crown, Library, Loader2, Puzzle, Swords } from "lucide-react";
import type { Color } from "@chaturanga/shared/types/chess";
import type { GameOpening, MoveReview } from "@chaturanga/shared/types/engine";
import type { KeyMoment } from "@chaturanga/shared/chess/key-moments";
import { annotationLabel } from "@chaturanga/shared/chess/move-assessment";
import { Button } from "@/components/ui/button";
import {
  CollapsibleBody,
  CollapsibleHeader,
  CollapsibleToggle,
  useCollapsible,
  type Collapsible
} from "@/components/ui/collapsible-section";
import { annotationTone } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useDatabasesQuery } from "../../queries/api";
import { useGameStore } from "../../stores/game-store";
import { MoveMarkDisc } from "../board/MoveMarkDisc";
import { MomentCommentaryPrompt, MomentList } from "./KeyMoments";
import {
  lichessOpeningProbe,
  findOpeningPuzzles,
  setOpeningPuzzleFilter,
  setThemePuzzleFilter
} from "./practice-puzzles";
import { gamePhases, type GamePhase } from "@chaturanga/shared/chess/game-phases";
import {
  openingBookLine,
  phaseAccuracy,
  practiceChips,
  scoreboardRows,
  sideAccuracy,
  type PracticeChip
} from "./review-summary";

/** label | White | glyph | Black: every row of the scoreboard shares these four tracks. */
const TRACKS = "grid grid-cols-[minmax(0,1fr)_4.5rem_2rem_4.5rem] items-center gap-x-2";

/**
 * Each cell's track, placed explicitly and centred in it: a row whose label is visually hidden
 * (taken out of the flow) must not slide its White box into the label track.
 */
const CELL = {
  label: "col-start-1",
  white: "col-start-2 justify-self-center text-center tabular-nums",
  glyph: "col-start-3 grid place-items-center justify-self-center",
  black: "col-start-4 justify-self-center text-center tabular-nums"
} as const;

/** A section's header row: a hairline above every section but the first, one height for all. */
const SECTION_HEAD = "col-span-full min-h-11 border-t border-line-subtle first:border-t-0";

const PHASE_LABELS: Record<GamePhase, string> = {
  opening: "Opening",
  middlegame: "Middlegame",
  endgame: "Endgame"
};

const PHASE_ICONS: Record<GamePhase, ReactNode> = {
  opening: <BookOpen className="size-[17px]" strokeWidth={1.8} aria-hidden />,
  middlegame: <Swords className="size-[17px]" strokeWidth={1.8} aria-hidden />,
  endgame: <Crown className="size-[17px]" strokeWidth={1.8} aria-hidden />
};

/**
 * The review summary, the Summary tab after a review, in folding sections: Accuracy (each side's
 * accuracy on the header row, so it shows folded too, then the marks on one scoreboard: label |
 * White | glyph | Black), the reviewed side's key moments (cards that open on the move's AI
 * commentary), the opening with its puzzles and the repertoire comparison, accuracy by phase, and
 * puzzle themes behind the reviewed side's errors. No centipawn loss and no player names (the board
 * shows them).
 */
export const ReviewSummary = memo(function ReviewSummary({
  moves,
  mainline,
  opening,
  side,
  moments,
  onSelectNode,
  repertoire,
  onOpenPuzzles,
  onAddCommentaryKey
}: {
  moves: readonly MoveReview[];
  /** The game's main line, as the charts split it into phases (the two always agree). */
  mainline: readonly { ply: number; fenBefore: string }[];
  /** The review's opening (undefined: a review from before the opening book). */
  opening: GameOpening | null | undefined;
  /** The side reviewed: its errors make the practice chips. */
  side: Color;
  /** The reviewed side's key moments (the stepper's insights), as cards. */
  moments: readonly KeyMoment[];
  /** Goes to a key moment's move. */
  onSelectNode: (nodeId: string) => void;
  /**
   * The game against the user's repertoire: a one-line headline (nothing without a repertoire
   * for the side), and the comparison "My repertoire" unfolds in the Opening section.
   */
  repertoire: { headline: ReactNode; panel: ReactNode };
  /** Shows the Puzzles page (its filters are set first); absent: no puzzle shortcuts. */
  onOpenPuzzles?: () => void;
  /** Opens Settings → AI, offered under the key moments when no OpenRouter key is saved. */
  onAddCommentaryKey?: () => void;
}) {
  const rows = useMemo(() => scoreboardRows(moves), [moves]);
  const white = useMemo(() => sideAccuracy(moves, "white"), [moves]);
  const black = useMemo(() => sideAccuracy(moves, "black"), [moves]);
  const phases = useMemo(
    () => phaseAccuracy(moves, gamePhases(mainline, opening)),
    [mainline, moves, opening]
  );
  const chips = useMemo(() => practiceChips(moves, side), [moves, side]);
  const databases = useDatabasesQuery();
  const lichessDatabaseId =
    databases.data?.find((item) => item.sourceId === "lichess-puzzles")?.id ?? null;
  const accuracy = useCollapsible("review-summary:accuracy");

  const openThemePuzzles = (chip: PracticeChip) => {
    if (!onOpenPuzzles) return;
    setThemePuzzleFilter(chip.theme, lichessDatabaseId);
    onOpenPuzzles();
  };

  return (
    <div
      className="scroll-area -mr-3 h-full min-h-0 overflow-y-auto pr-3"
      aria-label="Review summary"
      role="region"
    >
      <div className={cn(TRACKS, "pb-2 text-sm text-fg-secondary")}>
        {/* ⌄ Accuracy  [White] (dartboard) [Black]: the boxes sit on the header row, on the
            scoreboard's tracks, so they stay in view with the marks folded. */}
        <div className={cn(SECTION_HEAD, "grid grid-cols-subgrid items-center")}>
          <CollapsibleToggle
            open={accuracy.open}
            onToggle={accuracy.toggle}
            controls={accuracy.contentId}
            className={CELL.label}
          >
            Accuracy
          </CollapsibleToggle>
          <AccuracyBox side="white" value={white} />
          <span className={CELL.glyph}>
            <Dartboard />
          </span>
          <AccuracyBox side="black" value={black} />
        </div>
        <SectionBody section={accuracy}>
          {rows.length ? (
            <div role="table" aria-label="Marks" className="col-span-full grid grid-cols-subgrid">
              {rows.map((row) => (
                <div
                  key={row.annotation}
                  role="row"
                  className="col-span-full grid min-h-[34px] grid-cols-subgrid items-center"
                >
                  <span role="rowheader" className={cn(CELL.label, "font-medium text-fg")}>
                    {annotationLabel(row.annotation)}
                  </span>
                  <Count
                    value={row.white}
                    tone={annotationTone[row.annotation].text}
                    label="White"
                  />
                  <span role="cell" className={CELL.glyph}>
                    <MoveMarkDisc annotation={row.annotation} decorative />
                  </span>
                  <Count
                    value={row.black}
                    tone={annotationTone[row.annotation].text}
                    label="Black"
                  />
                </div>
              ))}
            </div>
          ) : null}
        </SectionBody>

        {moments.length ? (
          <SummarySection
            id="key-moments"
            title="Key moments"
            actions={
              <span className="text-xs font-medium tabular-nums text-fg-subtle">
                {moments.length}
              </span>
            }
          >
            <KeyMomentCards
              moments={moments}
              moves={moves}
              onSelectNode={onSelectNode}
              onAddCommentaryKey={onAddCommentaryKey}
            />
          </SummarySection>
        ) : null}

        <SummarySection id="opening" title="Opening">
          <OpeningBlock
            opening={opening ?? null}
            lichessDatabaseId={lichessDatabaseId}
            repertoire={repertoire}
            onOpenPuzzles={onOpenPuzzles}
          />
        </SummarySection>

        {phases.length ? (
          <SummarySection id="phases" title="Phases">
            <div
              role="table"
              aria-label="Accuracy by phase"
              className="col-span-full grid grid-cols-subgrid"
            >
              {phases.map((phase) => (
                <div
                  key={phase.phase}
                  role="row"
                  className="col-span-full grid min-h-[34px] grid-cols-subgrid items-center"
                >
                  <span role="rowheader" className={cn(CELL.label, "font-medium text-fg")}>
                    {PHASE_LABELS[phase.phase]}
                  </span>
                  <Percent value={phase.white} label="White" />
                  <span role="cell" className={cn(CELL.glyph, "text-fg-muted")}>
                    {PHASE_ICONS[phase.phase]}
                  </span>
                  <Percent value={phase.black} label="Black" />
                </div>
              ))}
            </div>
          </SummarySection>
        ) : null}

        {chips.length && onOpenPuzzles ? (
          <SummarySection id="practice" title="Practice">
            <div
              role="group"
              aria-label="Practise your mistakes"
              className="col-span-full flex flex-wrap gap-1.5"
            >
              {chips.map((chip) => (
                <button
                  key={chip.theme}
                  type="button"
                  title={`${chip.label} puzzles`}
                  className="inline-flex h-[30px] items-center gap-1.5 rounded-full border border-line bg-surface pr-1.5 pl-3 text-[12.5px] text-fg-secondary transition-colors duration-micro hover:border-line-strong hover:bg-control hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                  onClick={() => openThemePuzzles(chip)}
                >
                  {chip.label}
                  <span className="grid h-[18px] min-w-5 place-items-center rounded-full bg-control px-1.5 text-2xs font-semibold tabular-nums text-fg-muted">
                    {chip.count}
                  </span>
                </button>
              ))}
            </div>
          </SummarySection>
        ) : null}
      </div>
    </div>
  );
});

/**
 * A summary section: the panel's one header style (⌄ Opening, its chevron at the left, as the
 * charts' "Winning chances"), folding remembered per section; the body keeps the four tracks.
 */
function SummarySection({
  id,
  title,
  actions,
  children
}: {
  id: string;
  title: string;
  /** At the header row's right (a count). */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const section = useCollapsible(`review-summary:${id}`);
  return (
    <>
      <CollapsibleHeader
        open={section.open}
        onToggle={section.toggle}
        controls={section.contentId}
        size="sub"
        actions={actions}
        className={SECTION_HEAD}
      >
        {title}
      </CollapsibleHeader>
      <SectionBody section={section}>{children}</SectionBody>
    </>
  );
}

/** A section's body, on the four tracks, indented under its title. */
function SectionBody({ section, children }: { section: Collapsible; children: ReactNode }) {
  return (
    <CollapsibleBody section={section} className="col-span-full grid grid-cols-subgrid pb-3 pl-5">
      {children}
    </CollapsibleBody>
  );
}

/**
 * The key moments as cards, the one being shown highlighted, then (while the cards can't explain
 * a move) the way to have them do so. Reads the shown move itself, so moving through the game
 * re-renders only this list.
 */
function KeyMomentCards({
  moments,
  moves,
  onSelectNode,
  onAddCommentaryKey
}: {
  moments: readonly KeyMoment[];
  moves: readonly MoveReview[];
  onSelectNode: (nodeId: string) => void;
  onAddCommentaryKey?: () => void;
}) {
  const selectedNodeId = useGameStore((state) => state.currentNodeId);
  return (
    <div className="col-span-full grid gap-2">
      <MomentList
        moments={moments}
        moves={moves}
        selectedNodeId={selectedNodeId}
        onSelectNode={onSelectNode}
        label="Key moments"
        emptyTitle="No key moments."
      />
      <MomentCommentaryPrompt onAddKey={onAddCommentaryKey} />
    </div>
  );
}

/** A side's accuracy: White's in a light box, Black's in a dark one. */
function AccuracyBox({ side, value }: { side: Color; value: number | null }) {
  const name = side === "white" ? "White" : "Black";
  return (
    <span className={side === "white" ? CELL.white : CELL.black}>
      <span
        aria-label={`${name} accuracy ${value === null ? "unknown" : value.toFixed(1)}`}
        className={cn(
          "flex h-8 w-16 items-center justify-center rounded-md font-mono text-[15px] font-bold tabular-nums",
          side === "white"
            ? "bg-side-white text-side-white-fg"
            : "bg-side-black text-fg ring-1 ring-line ring-inset"
        )}
      >
        {value === null ? "—" : value.toFixed(1)}
      </span>
    </span>
  );
}

/** A mark's count for one side, in the mark's colour (a zero muted). */
function Count({ value, tone, label }: { value: number; tone: string; label: "White" | "Black" }) {
  return (
    <span
      role="cell"
      aria-label={`${label} ${value}`}
      className={cn(
        label === "White" ? CELL.white : CELL.black,
        "font-mono text-sm font-bold",
        value ? tone : "text-fg-subtle"
      )}
    >
      {value}
    </span>
  );
}

/** A phase accuracy: the whole percent, then a small muted "%". */
function Percent({ value, label }: { value: number | null; label: "White" | "Black" }) {
  return (
    <span
      role="cell"
      aria-label={`${label} ${value === null ? "unknown" : `${value}%`}`}
      className={cn(
        label === "White" ? CELL.white : CELL.black,
        "font-mono text-[15px] font-semibold text-fg"
      )}
    >
      {value === null ? (
        "—"
      ) : (
        <>
          {value}
          <small className="ml-px text-2xs font-medium text-fg-subtle">%</small>
        </>
      )}
    </span>
  );
}

/** The red dartboard in the Accuracy row's glyph column (no text). */
function Dartboard() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 32 32"
      role="img"
      aria-label="Accuracy"
      className="drop-shadow-[0_1px_2px_rgb(0_0_0/0.5)]"
    >
      <circle cx="16" cy="16" r="15" fill="var(--color-mark-blunder)" />
      <circle cx="16" cy="16" r="11" fill="var(--color-fg)" />
      <circle cx="16" cy="16" r="7" fill="var(--color-mark-blunder)" />
      <circle cx="16" cy="16" r="3" fill="var(--color-fg)" />
      <path d="M16 16 L27 5" stroke="#1b1d20" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M24.5 4.5 L28.5 3.5 L27.5 7.5 Z" fill="#1b1d20" />
    </svg>
  );
}

/** The game's opening: its name, where the book ended, and the two ways to work on it. */
function OpeningBlock({
  opening,
  lichessDatabaseId,
  repertoire,
  onOpenPuzzles
}: {
  /** The game's named opening (null: it reached none; then only the repertoire is offered). */
  opening: GameOpening | null;
  lichessDatabaseId: string | null;
  repertoire: { headline: ReactNode; panel: ReactNode };
  onOpenPuzzles?: () => void;
}) {
  // "My repertoire" unfolds the comparison here (folded at first, then as last left).
  const comparison = useCollapsible("review-summary:repertoire", false);
  // "idle", searching the puzzle file ("finding"), or nothing found even for the family ("none").
  const [search, setSearch] = useState<"idle" | "finding" | "none">("idle");
  // Leaving the summary gives the search up: its answer can't take the user to Puzzles any more.
  const leave = useRef<AbortController | null>(null);
  useEffect(() => () => leave.current?.abort(), []);

  const openPuzzles = async () => {
    if (!onOpenPuzzles || !opening || search === "finding") return;
    const controller = new AbortController();
    leave.current = controller;
    setSearch("finding");
    const result = await findOpeningPuzzles(
      opening.name,
      lichessOpeningProbe(lichessDatabaseId),
      controller.signal
    );
    if (result.status === "cancelled") return;
    setSearch(result.status === "none" ? "none" : "idle");
    if (result.status === "found") {
      setOpeningPuzzleFilter(result.tag, lichessDatabaseId);
      onOpenPuzzles();
    }
  };

  return (
    <div className="col-span-full grid min-w-0 gap-0.5">
      {opening ? (
        <>
          <p className="flex min-w-0 items-center gap-2 font-medium text-fg">
            <MoveMarkDisc annotation="book" decorative />
            <span className="font-mono text-xs font-bold text-mark-book-text">{opening.eco}</span>
            <span className="min-w-0 truncate" title={opening.name}>
              {opening.name}
            </span>
          </p>
          <p className="mt-1 text-[12.5px] text-fg-muted">{openingBookLine(opening)}</p>
        </>
      ) : null}
      {/* The game against the user's repertoire, in one muted line (none without one). */}
      {repertoire.headline}
      <div className="mt-2.5 grid grid-cols-2 gap-1.5">
        {onOpenPuzzles && opening ? (
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={search === "finding"}
            aria-busy={search === "finding" || undefined}
            onClick={() => void openPuzzles()}
          >
            {search === "finding" ? <Loader2 className="animate-spin" /> : <Puzzle />}
            {search === "finding" ? "Finding puzzles…" : "Opening puzzles"}
          </Button>
        ) : null}
        {/* Pressed (the primary tint) while its comparison is unfolded below. */}
        <Button
          type="button"
          variant={comparison.open ? "primary" : "default"}
          size="sm"
          className={cn((!onOpenPuzzles || !opening) && "col-span-2")}
          aria-expanded={comparison.open}
          aria-controls={comparison.contentId}
          onClick={comparison.toggle}
        >
          <Library />
          My repertoire
        </Button>
      </div>
      {search === "none" ? (
        <p role="status" className="mt-1 text-xs text-fg-muted">
          No puzzles for this opening yet.
        </p>
      ) : null}
      <CollapsibleBody
        section={comparison}
        role="region"
        aria-label="Your repertoire"
        className="mt-2.5 rounded-lg border border-line-subtle bg-surface-sunken p-3"
      >
        {repertoire.panel}
      </CollapsibleBody>
    </div>
  );
}
