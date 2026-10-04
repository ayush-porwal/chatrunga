import { memo, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpen, Crown, Library, Loader2, Puzzle, Swords } from "lucide-react";
import type { Color } from "@chaturanga/shared/types/chess";
import type { GameOpening, MoveReview } from "@chaturanga/shared/types/engine";
import { annotationLabel } from "@chaturanga/shared/chess/move-assessment";
import { Button } from "@/components/ui/button";
import {
  CollapsibleBody,
  CollapsibleHeader,
  useCollapsible
} from "@/components/ui/collapsible-section";
import { SideDot } from "@/components/ui/side-dot";
import { annotationTone } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useDatabasesQuery } from "../../queries/api";
import { MoveMarkDisc } from "../board/MoveMarkDisc";
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
 * The review summary, the side panel's first screen after a review: each side's accuracy and
 * marks on one scoreboard (label | White | glyph | Black), then the opening with its puzzles and
 * the repertoire comparison, accuracy by phase, and puzzle themes behind the reviewed side's
 * errors (Start review, the key moments one by one, is in the panel's footer). No centipawn loss
 * and no player names (the board shows them).
 */
export const ReviewSummary = memo(function ReviewSummary({
  moves,
  mainline,
  opening,
  side,
  onOpenRepertoire,
  onOpenPuzzles
}: {
  moves: readonly MoveReview[];
  /** The game's main line, as the charts split it into phases (the two always agree). */
  mainline: readonly { ply: number; fenBefore: string }[];
  /** The review's opening (undefined: a review from before the opening book). */
  opening: GameOpening | null | undefined;
  /** The side reviewed: its errors make the practice chips. */
  side: Color;
  /** The opening comparison with the user's repertoire (the Opening tab). */
  onOpenRepertoire: () => void;
  /** Shows the Puzzles page (its filters are set first); absent: no puzzle shortcuts. */
  onOpenPuzzles?: () => void;
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
      <div className={cn(TRACKS, "text-sm text-fg-secondary")}>
        {/* › Accuracy: its body is the accuracy boxes, then each side's marks. */}
        <SummarySection id="accuracy" title="Accuracy">
          <div role="table" aria-label="Accuracy" className="col-span-full grid grid-cols-subgrid">
            <div role="row" className="col-span-full grid min-h-9 grid-cols-subgrid items-center">
              <span role="rowheader" className="sr-only">
                Accuracy
              </span>
              <AccuracyBox side="white" value={white} />
              <span role="cell" className={CELL.glyph}>
                <Dartboard />
              </span>
              <AccuracyBox side="black" value={black} />
            </div>
          </div>
          {rows.length ? (
            <div
              role="table"
              aria-label="Marks"
              className="col-span-full grid grid-cols-subgrid pt-1"
            >
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
        </SummarySection>

        {opening ? (
          <SummarySection id="opening" title="Opening">
            <OpeningBlock
              opening={opening}
              lichessDatabaseId={lichessDatabaseId}
              onOpenRepertoire={onOpenRepertoire}
              onOpenPuzzles={onOpenPuzzles}
            />
          </SummarySection>
        ) : null}

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
              className="col-span-full flex flex-wrap gap-1.5 py-1"
            >
              {chips.map((chip) => (
                <button
                  key={chip.theme}
                  type="button"
                  title={`${chip.label} puzzles`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-raised px-2.5 py-1.5 text-[12.5px] text-fg-secondary transition-colors duration-micro hover:border-accent/40 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                  onClick={() => openThemePuzzles(chip)}
                >
                  {chip.label}
                  <span className="font-mono text-2xs font-semibold text-fg-subtle">
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
  children
}: {
  id: string;
  title: string;
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
        className="col-span-full mt-2"
      >
        {title}
      </CollapsibleHeader>
      <CollapsibleBody
        section={section}
        className="col-span-full grid grid-cols-subgrid pt-1 pl-[18px]"
      >
        {children}
      </CollapsibleBody>
    </>
  );
}

/** A side's accuracy: White's in a light box, Black's in a dark one. */
function AccuracyBox({ side, value }: { side: Color; value: number | null }) {
  const name = side === "white" ? "White" : "Black";
  return (
    <span role="cell" className={side === "white" ? CELL.white : CELL.black}>
      <span
        aria-label={`${name} accuracy ${value === null ? "unknown" : value.toFixed(1)}`}
        className={cn(
          "flex h-8 w-16 items-center justify-center rounded-md font-mono text-lg font-semibold tabular-nums",
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

/** A mark's count for one side, in the mark's colour. */
function Count({ value, tone, label }: { value: number; tone: string; label: "White" | "Black" }) {
  return (
    <span
      role="cell"
      aria-label={`${label} ${value}`}
      className={cn(
        label === "White" ? CELL.white : CELL.black,
        "font-mono text-base font-semibold",
        tone
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
  onOpenRepertoire,
  onOpenPuzzles
}: {
  opening: GameOpening;
  lichessDatabaseId: string | null;
  onOpenRepertoire: () => void;
  onOpenPuzzles?: () => void;
}) {
  // "idle", searching the puzzle file ("finding"), or nothing found even for the family ("none").
  const [search, setSearch] = useState<"idle" | "finding" | "none">("idle");
  // Leaving the summary gives the search up: its answer can't take the user to Puzzles any more.
  const leave = useRef<AbortController | null>(null);
  useEffect(() => () => leave.current?.abort(), []);

  const openPuzzles = async () => {
    if (!onOpenPuzzles || search === "finding") return;
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
    <div className="col-span-full flex items-start gap-2.5">
      <MoveMarkDisc annotation="book" decorative className="mt-px" />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="font-medium text-fg">
          <span className="mr-1 font-mono text-xs font-semibold text-mark-book-text">
            {opening.eco}
          </span>
          {opening.name}
        </p>
        <p className="text-[12.5px] text-fg-muted">{openingBookLine(opening)}</p>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {onOpenPuzzles ? (
            <Button
              type="button"
              variant="default"
              size="sm"
              className="bg-surface-raised"
              disabled={search === "finding"}
              aria-busy={search === "finding" || undefined}
              onClick={() => void openPuzzles()}
            >
              {search === "finding" ? <Loader2 className="animate-spin" /> : <Puzzle />}
              {search === "finding" ? "Finding puzzles…" : "Opening puzzles"}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="default"
            size="sm"
            className={cn("bg-surface-raised", !onOpenPuzzles && "col-span-2")}
            onClick={onOpenRepertoire}
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
      </div>
    </div>
  );
}

/**
 * Before an imported game's first review: which side to review it as, the side whose name is the
 * user's Lichess account (else the Settings side) preselected, then Start review.
 */
export function ReviewSidePrompt({
  preselect,
  whiteName,
  blackName,
  onStart
}: {
  preselect: Color;
  whiteName: string;
  blackName: string;
  /** Reviews the game as the side picked; absent while it can't start (the game is loading). */
  onStart?: (side: Color) => void;
}) {
  const headingId = useId();
  const [picked, setPicked] = useState<Color>(preselect);
  // A preselection that changes (the Lichess account connects) moves the pick until one is made.
  const [touched, setTouched] = useState(false);
  const side = touched ? picked : preselect;
  const options: { color: Color; name: string }[] = [
    { color: "white", name: whiteName },
    { color: "black", name: blackName }
  ];
  return (
    <div className="grid h-full content-center gap-4 px-1">
      <h2 id={headingId} className="text-center text-base font-semibold text-fg">
        Review this game as
      </h2>
      <div role="radiogroup" aria-labelledby={headingId} className="grid grid-cols-2 gap-2">
        {options.map((option) => {
          const checked = option.color === side;
          const label = option.color === "white" ? "White" : "Black";
          return (
            <button
              key={option.color}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={`${label} (${option.name})`}
              className={cn(
                "grid min-w-0 justify-items-center gap-1 rounded-lg border px-3 py-3 text-sm transition-colors duration-micro focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
                checked
                  ? "border-accent/60 bg-accent-soft text-fg"
                  : "border-line bg-surface-raised text-fg-secondary hover:border-line-strong"
              )}
              onClick={() => {
                setTouched(true);
                setPicked(option.color);
              }}
            >
              <span className="inline-flex items-center gap-1.5 font-medium">
                <SideDot color={option.color} />
                {label}
              </span>
              <span className="max-w-full truncate text-xs text-fg-muted">{option.name}</span>
            </button>
          );
        })}
      </div>
      <Button
        type="button"
        className="h-[42px] border-transparent bg-accent-strong text-sm font-semibold text-fg hover:bg-accent-strong/85"
        disabled={!onStart}
        onClick={() => onStart?.(side)}
      >
        Start review
      </Button>
    </div>
  );
}
