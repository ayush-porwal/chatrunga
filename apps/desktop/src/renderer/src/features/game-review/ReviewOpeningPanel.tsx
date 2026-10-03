import { memo, useEffect, useId, useMemo, useRef, type ReactNode } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  CircleHelp,
  Flag,
  FolderOpen,
  GraduationCap,
  Plus,
  Repeat,
  Shield
} from "lucide-react";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import {
  COMPARE_GAME_MAX_PLIES,
  type ComparisonMove,
  type ComparisonMoveStatus,
  type RepertoireColor,
  type RepertoireComparison
} from "@chaturanga/shared/types/repertoire";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { fieldHint, sectionTitle } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useUpdateSettingMutation } from "../../queries/api";
import { useRepertoireComparisonQuery, useRepertoiresQuery } from "../../queries/repertoire";
import { useGameStore } from "../../stores/game-store";
import { useLichessStore } from "../../stores/lichess-store";
import type { StudyOpenTarget } from "../repertoire/repertoire-chapters";
import {
  comparisonActions,
  defaultCompareColor,
  describeComparison,
  describeReturns,
  inRepertoireTarget,
  mainlineMoves,
  moveNumberOf,
  pickRepertoire,
  suggestedSide,
  tokenStatus,
  tokenTitle,
  type ComparisonAction,
  type ComparisonTone,
  type RememberedRepertoires
} from "./opening-comparison";

const colorOptions = [
  { value: "white" as const, label: "White" },
  { value: "black" as const, label: "Black" }
];

/** Active repertoires of both colours (one list; the picker filters by colour). */
const ALL_ACTIVE = { color: "all" } as const;

const COLOR_NAME: Record<RepertoireColor, string> = { white: "White", black: "Black" };

const noticeTone: Record<ComparisonTone, "info" | "warn" | "danger" | "success"> = {
  accent: "success",
  info: "info",
  warn: "warn",
  danger: "danger",
  neutral: "info"
};

/**
 * The game review's Opening tab (design §6.3): the player's side and repertoire, the game's
 * mainline against it (status line, chapters, returns by transposition, a move strip that follows
 * the review cursor) and the actions on the earliest difference. Runs locally from the recorded
 * moves; needs no engine review. The side is chosen by the player (a provenance hint at most),
 * never read from the board orientation.
 */
export const ReviewOpeningPanel = memo(function ReviewOpeningPanel({
  moveTree,
  selectedNodeId,
  onSelectNode,
  color: chosenColor,
  onColorChange,
  remembered,
  onStudy,
  onRefreshDecision,
  onHub
}: {
  moveTree: readonly MoveNode[];
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
  /** The side picked for this game (null: not picked yet, the default applies). */
  color: RepertoireColor | null;
  onColorChange: (color: RepertoireColor) => void;
  /** The last repertoire chosen per colour (settings). */
  remembered: RememberedRepertoires;
  onStudy?: (target: StudyOpenTarget) => void;
  onRefreshDecision?: (repertoireId: string, positionKey: string) => void;
  onHub?: () => void;
}) {
  const desktop = Boolean(window.chaturanga?.repertoires);
  const selectId = useId();
  const selectRef = useRef<HTMLSelectElement | null>(null);
  const rootFen = useGameStore((state) => state.rootFen);
  const source = useGameStore((state) => state.source);
  const headers = useGameStore((state) => state.headers);
  const engineSide = useGameStore((state) => state.engineSide);
  const lichessUsername = useLichessStore((state) => state.status.account?.username ?? null);
  const list = useRepertoiresQuery(ALL_ACTIVE);
  const repertoires = useMemo(() => list.data ?? [], [list.data]);
  const { mutate: updateSetting } = useUpdateSettingMutation();

  const suggestion = useMemo(
    () =>
      suggestedSide({
        source,
        headers,
        lichessUsername,
        engineSide
      }),
    [source, headers, lichessUsername, engineSide]
  );
  const color =
    chosenColor ?? defaultCompareColor(remembered, repertoires, suggestion?.color ?? null);
  const ofColor = useMemo(
    () => repertoires.filter((item) => item.color === color),
    [repertoires, color]
  );
  const repertoire = pickRepertoire(repertoires, color, remembered[color]);

  // The mainline once per tree (variations added while reviewing keep the same compare key).
  const mainline = useMemo(() => mainlineMoves(moveTree), [moveTree]);
  const input = useMemo(
    () =>
      repertoire
        ? {
            repertoireId: repertoire.id,
            color,
            rootFen,
            // Only the opening matters; the main process refuses longer mainlines.
            moves: mainline.slice(0, COMPARE_GAME_MAX_PLIES).map((move) => move.uci)
          }
        : null,
    [repertoire, color, rootFen, mainline]
  );
  const comparison = useRepertoireComparisonQuery(desktop ? input : null);

  const chooseRepertoire = (id: string) =>
    updateSetting({
      key: color === "white" ? "repertoireCompareWhite" : "repertoireCompareBlack",
      value: id
    });

  if (!desktop) {
    return (
      <EmptyState
        className="self-center"
        icon={<BookOpen />}
        title="Comparison needs the desktop app"
        description="Your repertoires live in the app's local library."
      />
    );
  }

  const header = (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          ariaLabel="Your side in this game"
          size="sm"
          value={color}
          onChange={onColorChange}
          options={colorOptions}
        />
        {ofColor.length ? (
          <div className="min-w-40 flex-1">
            <label htmlFor={selectId} className="sr-only">
              {COLOR_NAME[color]} repertoire
            </label>
            <Select
              id={selectId}
              ref={selectRef}
              className="h-8 text-xs"
              value={repertoire?.id ?? ""}
              onChange={(event) => chooseRepertoire(event.target.value)}
            >
              {ofColor.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>
      {suggestion ? (
        <p className={cn(fieldHint, "flex flex-wrap items-center gap-x-2")}>
          <span>{suggestion.hint}</span>
          {suggestion.color !== color ? (
            <Button
              type="button"
              variant="link"
              size="xs"
              className="text-2xs"
              onClick={() => onColorChange(suggestion.color)}
            >
              Compare as {COLOR_NAME[suggestion.color]}
            </Button>
          ) : null}
        </p>
      ) : null}
    </div>
  );

  let body: ReactNode;
  if (list.isPending) {
    body = <ComparisonSkeleton />;
  } else if (list.isError) {
    body = (
      <Notice tone="danger">
        {ipcErrorMessage(list.error) || "Your repertoires couldn't be read."}
      </Notice>
    );
  } else if (!repertoire) {
    body = (
      <EmptyState
        icon={<BookOpen />}
        title={`No ${COLOR_NAME[color]} repertoire yet`}
        description="Build one to see where this game left your preparation."
        action={
          onHub ? (
            <Button type="button" variant="primary" size="sm" onClick={onHub}>
              <Plus />
              Create
            </Button>
          ) : null
        }
      />
    );
  } else if (!mainline.length) {
    body = <EmptyState compact title="This game has no moves to compare." />;
  } else if (comparison.isPending) {
    body = <ComparisonSkeleton />;
  } else if (comparison.isError) {
    body = (
      <Notice tone="danger" title="Couldn't compare this game">
        {ipcErrorMessage(comparison.error) || "The comparison failed."}
      </Notice>
    );
  } else {
    body = (
      <ComparisonResult
        comparison={comparison.data}
        mainline={mainline}
        selectedNodeId={selectedNodeId}
        onSelectNode={onSelectNode}
        onAction={(action) => {
          switch (action.kind) {
            case "study":
              onStudy?.({
                repertoireId: comparison.data.repertoireId,
                chapterId: action.chapterId,
                nodeId: action.nodeId
              });
              break;
            case "stage":
              // Opens on Moves so the Choices panel shows the staged move (accepting it there is
              // the explicit policy change).
              onStudy?.({
                repertoireId: comparison.data.repertoireId,
                chapterId: action.chapterId,
                nodeId: action.nodeId,
                tab: "moves",
                stage: { nodeId: action.nodeId, uci: action.uci, edge: action.edge }
              });
              break;
            case "refresh":
              onRefreshDecision?.(comparison.data.repertoireId, action.positionKey);
              break;
            case "choose-repertoire":
              selectRef.current?.focus();
              break;
            case "hub":
              onHub?.();
              break;
          }
        }}
        canChooseAnother={ofColor.length > 1}
      />
    );
  }

  return (
    <div className="scroll-area -mr-3 flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-3">
      {header}
      {body}
    </div>
  );
});

function ComparisonSkeleton() {
  return (
    <div className="grid gap-3" role="status" aria-label="Comparing with your repertoire">
      <Skeleton className="h-10 w-full rounded-lg" />
      <Skeleton className="h-3 w-40" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

const ACTION_ICON: Record<ComparisonAction["kind"], ReactNode> = {
  study: <BookOpen />,
  refresh: <GraduationCap />,
  stage: <Plus />,
  "choose-repertoire": <FolderOpen />,
  hub: <Plus />
};

function ComparisonResult({
  comparison,
  mainline,
  selectedNodeId,
  onSelectNode,
  onAction,
  canChooseAnother
}: {
  comparison: RepertoireComparison;
  mainline: readonly { nodeId: string; ply: number }[];
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
  onAction: (action: ComparisonAction) => void;
  canChooseAnother: boolean;
}) {
  const summary = useMemo(() => describeComparison(comparison), [comparison]);
  const returns = useMemo(() => describeReturns(comparison), [comparison]);
  const actions = useMemo(() => {
    const list = comparisonActions(comparison.issue).filter(
      (action) => action.kind !== "choose-repertoire" || canChooseAnother
    );
    const target = inRepertoireTarget(comparison);
    return target
      ? [{ kind: "study" as const, label: "Open the chapter", ...target }, ...list]
      : list;
  }, [comparison, canChooseAnother]);
  const stage = actions.find((action) => action.kind === "stage");

  return (
    <div className="grid gap-4">
      <Notice tone={noticeTone[summary.tone]} aria-live="polite">
        {summary.text}
      </Notice>

      {actions.length ? (
        <div className="grid gap-1.5">
          <div className="flex flex-wrap gap-2">
            {actions.map((action, index) => (
              <Button
                key={`${action.kind}:${action.label}`}
                type="button"
                variant={index === 0 ? "primary" : "outline"}
                size="sm"
                onClick={() => onAction(action)}
              >
                {ACTION_ICON[action.kind]}
                {action.label}
              </Button>
            ))}
          </div>
          {stage?.kind === "stage" ? (
            <p className={fieldHint}>
              {stage.edge === "reference"
                ? "Opens the chapter at this position with your move added for study only (if the chapter doesn't have it); accept it under Choices to make it part of your plan."
                : "Opens the chapter with this reply added, or marked, as covered; then choose your answer to it."}
            </p>
          ) : null}
        </div>
      ) : null}

      {comparison.chaptersUsed.length ? (
        <section className="grid gap-1.5" aria-label="Chapters used">
          <h3 className={sectionTitle}>Chapters used</h3>
          <div className="flex flex-wrap gap-1.5">
            {comparison.chaptersUsed.map((chapter) => (
              <Badge key={chapter.chapterId} size="md">
                {chapter.title}
              </Badge>
            ))}
          </div>
        </section>
      ) : null}

      {returns.length ? (
        <ul className="grid gap-1 text-xs text-fg-muted" aria-label="Returns to known preparation">
          {returns.map((text, index) => (
            <li key={`${index}:${text}`} className="flex items-center gap-1.5">
              <Repeat className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
              {text}
            </li>
          ))}
        </ul>
      ) : null}

      <MoveStrip
        moves={comparison.moves}
        mainline={mainline}
        selectedNodeId={selectedNodeId}
        onSelectNode={onSelectNode}
      />
    </div>
  );
}

const TOKEN_TONE: Record<ReturnType<typeof tokenStatus>["tone"], string> = {
  accent: "text-accent decoration-accent",
  info: "text-info decoration-info",
  warn: "text-warn decoration-warn",
  danger: "text-danger decoration-danger",
  neutral: "text-fg-muted decoration-line-strong",
  subtle: "text-fg-subtle decoration-transparent"
};

const TOKEN_ICON: Partial<Record<ComparisonMoveStatus, ReactNode>> = {
  "player-choice": <Check />,
  "covered-reply": <Shield />,
  deviation: <ArrowUpRight />,
  uncovered: <CircleHelp />,
  "after-end": <Flag />,
  "transposed-back": <Repeat />
};

/**
 * The mainline as compact SAN tokens, each marked by status (colour, an icon and its text), the
 * review cursor's move highlighted. Clicking a token moves the cursor; cursor moves never take
 * focus.
 */
function MoveStrip({
  moves,
  mainline,
  selectedNodeId,
  onSelectNode
}: {
  moves: readonly ComparisonMove[];
  mainline: readonly { nodeId: string; ply: number }[];
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
}) {
  const nodeByPly = useMemo(
    () => new Map(mainline.map((move) => [move.ply, move.nodeId])),
    [mainline]
  );
  const listRef = useRef<HTMLOListElement | null>(null);

  // The cursor's token stays in view (scrolling only; focus stays where it is).
  useEffect(() => {
    const token = listRef.current?.querySelector<HTMLElement>('[aria-current="step"]');
    token?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [selectedNodeId]);

  return (
    <section className="grid gap-2" aria-label="Game moves against your repertoire">
      <h3 className={sectionTitle}>Moves</h3>
      <ol ref={listRef} className="flex flex-wrap items-center gap-x-0.5 gap-y-1">
        {moves.map((move, index) => {
          const nodeId = nodeByPly.get(move.ply) ?? null;
          const status = tokenStatus(move.status);
          const current = nodeId !== null && nodeId === selectedNodeId;
          const { number, white } = moveNumberOf(move.fenBefore);
          const showNumber = white || index === 0;
          return (
            <li key={`${move.ply}:${move.uci}`} className="inline-flex items-center">
              {showNumber ? (
                <span className="pl-1 pr-0.5 font-mono text-2xs text-fg-subtle" aria-hidden>
                  {number}
                  {white ? "." : "…"}
                </span>
              ) : null}
              <button
                type="button"
                disabled={!nodeId}
                aria-current={current ? "step" : undefined}
                aria-label={tokenTitle(move)}
                title={tokenTitle(move)}
                onClick={() => nodeId && onSelectNode(nodeId)}
                className={cn(
                  "inline-flex h-6 items-center gap-0.5 rounded px-1 font-mono text-xs underline decoration-2 underline-offset-4 outline-none transition-colors duration-micro hover:bg-control focus-visible:ring-2 focus-visible:ring-accent/70 [&_svg]:size-3 [&_svg]:shrink-0",
                  TOKEN_TONE[status.tone],
                  move.status === "outside-scope" && "no-underline",
                  move.status === "transposed-back" && "decoration-dotted",
                  current && "bg-accent-soft text-fg ring-1 ring-accent/50"
                )}
              >
                {move.san}
                {TOKEN_ICON[move.status] ? (
                  <span aria-hidden className="inline-flex">
                    {TOKEN_ICON[move.status]}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
      <Legend moves={moves} />
    </section>
  );
}

/** The statuses present in the strip, as icon + text (what the marks mean). */
function Legend({ moves }: { moves: readonly ComparisonMove[] }) {
  const present = useMemo(() => {
    const seen = new Set(moves.map((move) => move.status));
    return (Object.keys(TOKEN_ICON) as ComparisonMoveStatus[]).filter((status) => seen.has(status));
  }, [moves]);
  if (!present.length) return null;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Move marks">
      {present.map((status) => (
        <li
          key={status}
          className={cn(
            "inline-flex items-center gap-1 text-2xs [&_svg]:size-3",
            TOKEN_TONE[tokenStatus(status).tone]
          )}
        >
          <span aria-hidden className="inline-flex">
            {TOKEN_ICON[status]}
          </span>
          <span className="text-fg-muted">{tokenStatus(status).label}</span>
        </li>
      ))}
    </ul>
  );
}
