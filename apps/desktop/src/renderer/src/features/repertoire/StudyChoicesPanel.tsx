import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Star } from "lucide-react";
import { buildChapterLookup, type ChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import { playerToMove } from "@chaturanga/shared/chess/repertoire-position";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type {
  RepertoireChapter,
  RepertoireColor,
  RepertoireDecision,
  RepertoireOccurrence
} from "@chaturanga/shared/types/repertoire";
import type { RepertoireHealthFlag } from "@chaturanga/shared/types/repertoire-health";
import { defaultSettings } from "@chaturanga/shared/types/settings";
import { Badge } from "@/components/ui/badge";
import {
  CollapsibleBody,
  CollapsibleHeader,
  useCollapsible
} from "@/components/ui/collapsible-section";
import { cn } from "@/lib/utils";
import { useSettingsQuery } from "../../queries/api";
import { useRepertoireChapterData } from "../../queries/repertoire-study";
import { deriveChoices, moveKinds, type MoveKind } from "./repertoire-model";
import {
  positionChoices,
  repertoireArrows,
  type ChoiceSource,
  type PositionChoice
} from "./study-choices";
import { HEALTH_FLAG_LABELS, healthFlagText } from "./study-from-games";

/** Each other chapter's moves and their kinds, once per stored chapter (the queries' data). */
const chapterKinds = new WeakMap<
  RepertoireChapter,
  { lookup: ChapterLookup; kinds: Map<string, MoveKind> }
>();

function kindsOf(chapter: RepertoireChapter, color: RepertoireColor) {
  let entry = chapterKinds.get(chapter);
  if (!entry) {
    const lookup = buildChapterLookup(chapter);
    entry = { lookup, kinds: moveKinds(chapter, lookup, color) };
    chapterKinds.set(chapter, entry);
  }
  return entry;
}

/** A node's continuations with their kinds, leaving out `skip` (staged moves). */
function movesOf(
  lookup: ChapterLookup,
  kinds: ReadonlyMap<string, MoveKind>,
  nodeId: string,
  skip?: ReadonlySet<string>
): ChoiceSource["moves"] {
  return (lookup.childrenById.get(nodeId) ?? [])
    .filter((id) => !skip?.has(id))
    .map((id) => lookup.nodesById.get(id)!)
    .filter((child): child is MoveNode & { uci: string } => Boolean(child.uci))
    .map((child) => ({
      nodeId: child.id,
      uci: child.uci,
      san: child.san ?? child.uci,
      kind: kinds.get(child.id) ?? "reference"
    }));
}

/**
 * The selected position's choices across the repertoire: the open chapter's moves (the shown
 * chapter: its lookup and kinds, staged moves left out) and those of the other chapters reaching
 * the position (read through their chapter queries), with the preferred move and health flags.
 */
export function useStudyChoices({
  repertoireId,
  chapter,
  lookup,
  kinds,
  node,
  positionKey,
  decision,
  otherOccurrences,
  color,
  staged,
  flags
}: {
  repertoireId: string;
  /** The shown chapter, its lookup and the selected node (null until the chapter is loaded). */
  chapter: RepertoireChapter | null;
  lookup: ChapterLookup | null;
  kinds: ReadonlyMap<string, MoveKind>;
  node: MoveNode | null;
  positionKey: string | null;
  decision: RepertoireDecision | null;
  otherOccurrences: readonly RepertoireOccurrence[];
  color: RepertoireColor;
  staged: ReadonlySet<string>;
  flags: readonly RepertoireHealthFlag[];
}): { side: "player" | "opponent"; choices: PositionChoice[] } {
  const chapterIds = useMemo(
    () => [...new Set(otherOccurrences.map((occurrence) => occurrence.chapterId))],
    [otherOccurrences]
  );
  const others = useRepertoireChapterData(repertoireId, chapterIds);
  const side = node && playerToMove(node.fenAfter) !== color ? "opponent" : "player";
  const choices = useMemo(() => {
    if (!chapter || !lookup || !node) return [];
    const rows = deriveChoices(chapter, lookup, { nodeId: node.id, color, decision }).rows;
    const preferredUci =
      rows.find((row) => row.state === "preferred")?.uci ?? decision?.preferredUci ?? null;
    const sources: ChoiceSource[] = [
      {
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        nodeId: node.id,
        moves: movesOf(lookup, kinds, node.id, staged)
      }
    ];
    for (const occurrence of otherOccurrences) {
      const stored = others[chapterIds.indexOf(occurrence.chapterId)];
      if (!stored) continue;
      // Each other chapter's kinds are worked out once per stored chapter.
      const other = kindsOf(stored, color);
      sources.push({
        chapterId: occurrence.chapterId,
        chapterTitle: occurrence.chapterTitle,
        nodeId: occurrence.nodeId,
        moves: movesOf(other.lookup, other.kinds, occurrence.nodeId)
      });
    }
    return positionChoices({ fen: node.fenAfter, positionKey, sources, preferredUci, flags });
  }, [
    chapter,
    lookup,
    kinds,
    node,
    color,
    decision,
    staged,
    otherOccurrences,
    chapterIds,
    others,
    positionKey,
    flags
  ]);
  return { side, choices };
}

const KIND_TEXT: Record<MoveKind, string> = {
  yours: "Practised",
  covered: "Covered",
  reference: "Study-only"
};

/**
 * The choices panel (above the tree, folding): "Your move" or "Their replies" at the selected
 * position, every move the repertoire has there across its chapters: its kind, ★ for the
 * preferred one, its chapters and health flags. A move selects (in this chapter) or opens its
 * chapter there; `renderMenu` gives a move of this chapter its ⋯ (the move menu).
 */
export function StudyChoicesPanel({
  side,
  choices,
  currentChapterId,
  renderMenu,
  onOpen
}: {
  side: "player" | "opponent";
  choices: readonly PositionChoice[];
  currentChapterId: string;
  renderMenu: (choice: PositionChoice) => ReactNode;
  onOpen: (choice: PositionChoice) => void;
}) {
  const section = useCollapsible("study:choices");
  const heading = side === "player" ? "Your move" : "Their replies";
  return (
    <section aria-label="Choices" className="shrink-0 border-b border-line-subtle px-3 pb-2">
      <CollapsibleHeader
        open={section.open}
        onToggle={section.toggle}
        controls={section.contentId}
        size="sub"
        className="min-h-9"
      >
        Choices · {heading}
      </CollapsibleHeader>
      <CollapsibleBody section={section}>
        {choices.length ? (
          <ul className="grid gap-0.5" aria-label={heading}>
            {choices.map((choice) => (
              <ChoiceRow
                key={choice.uci}
                choice={choice}
                elsewhere={choice.at.chapterId !== currentChapterId}
                menu={choice.at.chapterId === currentChapterId ? renderMenu(choice) : null}
                onOpen={() => onOpen(choice)}
              />
            ))}
          </ul>
        ) : (
          <p className="py-1 text-xs text-fg-muted">
            {side === "player"
              ? "No move of yours here yet — play one on the board."
              : "No replies covered yet."}
          </p>
        )}
      </CollapsibleBody>
    </section>
  );
}

function ChoiceRow({
  choice,
  elsewhere,
  menu,
  onOpen
}: {
  choice: PositionChoice;
  /** Only in other chapters: the move opens the first of them. */
  elsewhere: boolean;
  menu: ReactNode;
  onOpen: () => void;
}) {
  return (
    <li className="flex min-h-8 min-w-0 items-center gap-2">
      <button
        type="button"
        title={elsewhere ? `Open in ${choice.chapters[0]}` : undefined}
        className={cn(
          "inline-flex h-7 shrink-0 items-center gap-1 rounded px-1.5 font-mono text-xs outline-none transition-colors duration-micro hover:bg-control focus-visible:ring-2 focus-visible:ring-accent/50",
          choice.kind === "reference" ? "text-fg-subtle" : "text-fg"
        )}
        onClick={onOpen}
      >
        {choice.label}
        {choice.preferred ? (
          <Star aria-label="Preferred" className="size-3 fill-current text-accent" />
        ) : null}
      </button>
      <span className="shrink-0 text-2xs text-fg-muted">{KIND_TEXT[choice.kind]}</span>
      <span
        className="min-w-0 flex-1 truncate text-2xs text-fg-subtle"
        title={choice.chapters.join(", ")}
      >
        {choice.chapters.join(", ")}
      </span>
      {choice.flags.map((flag) => (
        <Badge key={flag.kind} tone="warn" title={healthFlagText(flag)}>
          <AlertTriangle aria-hidden />
          {HEALTH_FLAG_LABELS[flag.kind]}
        </Badge>
      ))}
      {menu ? <span className="flex shrink-0">{menu}</span> : null}
    </li>
  );
}

/** The repertoire's arrows for the choices, unless the Study setting turns them off. */
export function useRepertoireArrows(choices: readonly PositionChoice[]) {
  const on =
    useSettingsQuery().data?.studyRepertoireArrows ?? defaultSettings.studyRepertoireArrows;
  return useMemo(() => (on ? repertoireArrows(choices) : []), [on, choices]);
}

/** A choice's ⋯: the move menu, with its own open state. */
export function ChoiceMoveMenu({
  render
}: {
  render: (open: boolean, onOpenChange: (open: boolean) => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return render(open, setOpen);
}

/** The health check's flags on the shown tree's moves: node id → what the flag says. */
export function useMoveFlags(
  lookup: ChapterLookup | null,
  flags: readonly RepertoireHealthFlag[]
): ReadonlyMap<string, string> {
  return useMemo(() => {
    const marked = new Map<string, string>();
    if (!lookup || !flags.length) return marked;
    const byPosition = new Map<string, RepertoireHealthFlag[]>();
    for (const flag of flags) {
      byPosition.set(flag.positionKey, [...(byPosition.get(flag.positionKey) ?? []), flag]);
    }
    for (const id of lookup.order) {
      const move = lookup.nodesById.get(id)!;
      const atParent = byPosition.get(lookup.positionKeys.get(move.parentId ?? "") ?? "");
      const flag = atParent?.find((item) => item.uci === move.uci);
      if (flag) marked.set(id, healthFlagText(flag));
    }
    return marked;
  }, [lookup, flags]);
}
