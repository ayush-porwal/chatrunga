import { useMemo } from "react";
import {
  ArrowUpToLine,
  Check,
  Flag,
  Lightbulb,
  MessageSquareText,
  PauseCircle,
  PlayCircle,
  Repeat,
  Star,
  StopCircle,
  Trash2
} from "lucide-react";
import { nodeMetaOf, type ChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import { playerToMove } from "@chaturanga/shared/chess/repertoire-position";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type {
  RepertoireChapter,
  RepertoireColor,
  RepertoireNodeMeta,
  RepertoireOccurrence
} from "@chaturanga/shared/types/repertoire";
import { OverflowMenu, type MenuItem } from "@/components/ui/menu";
import { useRepertoireDecisionQuery } from "../../queries/repertoire";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import {
  decisionDraftKey,
  deriveChoices,
  type DecisionTextDraft,
  type MoveKind
} from "./repertoire-model";

const CHECK = <Check />;
/** Keeps an unchecked choice's label in line with the checked one's. */
const NO_CHECK = <span aria-hidden="true" className="size-4 shrink-0" />;

type MoveMenuProps = {
  repertoireId: string;
  chapter: RepertoireChapter;
  lookup: ChapterLookup;
  color: RepertoireColor;
  node: MoveNode;
  /** The move's kind (undefined at the root). */
  kind: MoveKind | undefined;
  /** The selected position's key. */
  positionKey: string | null;
  /** The position's decision is paused (its unsaved change counts). */
  paused: boolean;
  /** The player is to move after this move and has accepted a move there. */
  canEditDecision: boolean;
  otherOccurrences: readonly RepertoireOccurrence[];
  canPromote: boolean;
  busy: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSetMeta: (nodeId: string, patch: Partial<RepertoireNodeMeta>) => void;
  /** Makes the move the preferred one at its position (`positionKey` of the parent). */
  onPrefer: (positionKey: string, uci: string) => void;
  onSetPaused: (paused: boolean) => void;
  onEditComment: () => void;
  onEditDecision: () => void;
  onOpenOccurrence: (occurrence: RepertoireOccurrence) => void;
  onPromote: () => void;
  onDelete: () => void;
};

/**
 * The selected move's actions, in one menu (the ⋯ on the selected move, or a right-click on any
 * move): what the move is (one of yours, a covered reply, or study only), the preferred move,
 * where training starts and stops, pausing practice of the position, its comment and its practice
 * prompt, hint and feedback, the other chapters reaching the position, then promote and delete.
 * At the root (the "Starting position" row) only what applies to a position is offered.
 */
export function StudyMoveMenu(props: MoveMenuProps) {
  const { repertoireId, chapter, lookup, color, node, kind } = props;
  const parentId = node.parentId;
  const parentKey = parentId ? (lookup.positionKeys.get(parentId) ?? null) : null;
  const parentDecision = useRepertoireDecisionQuery(repertoireId, parentKey).data ?? null;
  // Preferring is offered for one of your moves accepted beside others, not yet the preferred one.
  const preferable = useMemo(() => {
    if (!parentId || kind !== "yours") return false;
    const choices = deriveChoices(chapter, lookup, {
      nodeId: parentId,
      color,
      decision: parentDecision
    });
    return choices.rows.some((row) => row.nodeId === node.id && row.state === "accepted");
  }, [chapter, lookup, parentId, kind, color, parentDecision, node.id]);
  const items = [
    ...(node.uci ? moveItems(props, preferable ? parentKey : null) : []),
    ...positionItems(props),
    ...editItems(props)
  ];
  return (
    <OverflowMenu
      label={node.san ? `${node.san} actions` : "Starting position actions"}
      size="icon-xs"
      open={props.open}
      onOpenChange={props.onOpenChange}
      items={items}
    />
  );
}

/**
 * What the move is (one of yours or an opponent reply, else study only), making it the preferred
 * move (`preferAt`: its position's key, when offered) and the training marks on it.
 */
function moveItems(props: MoveMenuProps, preferAt: string | null): (MenuItem | false)[] {
  const { chapter, color, node, kind, busy, onSetMeta } = props;
  const meta = nodeMetaOf(chapter.nodeMeta, node.id);
  const own = playerToMove(node.fenBefore) === color;
  const choice = (label: string, checked: boolean, edge: RepertoireNodeMeta["edge"]) => ({
    label,
    icon: checked ? CHECK : NO_CHECK,
    disabled: busy,
    onSelect: () => onSetMeta(node.id, { edge })
  });
  return [
    own
      ? choice("Your move", kind === "yours", "included")
      : choice("Opponent reply (covered)", kind === "covered", "covered"),
    choice("Study only (reference)", kind === "reference", "reference"),
    preferAt !== null && {
      label: "Make it the preferred move",
      icon: <Star />,
      disabled: busy,
      onSelect: () => props.onPrefer(preferAt, node.uci!)
    },
    {
      label: meta.trainingStart ? "Don't start training here" : "Start training here",
      icon: <Flag />,
      divided: true,
      onSelect: () => onSetMeta(node.id, { trainingStart: !meta.trainingStart })
    },
    {
      label: meta.trainingStop ? "Don't stop the branch here" : "Stop branch here",
      icon: <StopCircle />,
      onSelect: () => onSetMeta(node.id, { trainingStop: !meta.trainingStop })
    },
    meta.disabled === true && {
      label: "Include this branch again",
      icon: <PlayCircle />,
      onSelect: () => onSetMeta(node.id, { disabled: false })
    }
  ];
}

/** The position's own: pausing its practice, its comment and practice texts, its other chapters. */
function positionItems(props: MoveMenuProps): (MenuItem | false)[] {
  const { paused, canEditDecision, positionKey, busy } = props;
  return [
    canEditDecision &&
      positionKey !== null && {
        label: paused ? "Resume practice for this position" : "Pause practice for this position",
        icon: paused ? <PlayCircle /> : <PauseCircle />,
        divided: true,
        disabled: busy,
        onSelect: () => props.onSetPaused(!paused)
      },
    {
      label: "Edit comment…",
      icon: <MessageSquareText />,
      divided: !canEditDecision,
      onSelect: props.onEditComment
    },
    canEditDecision && {
      label: "Edit hint & prompt…",
      icon: <Lightbulb />,
      onSelect: props.onEditDecision
    },
    ...props.otherOccurrences.slice(0, 3).map((occurrence, index) => ({
      label: `Also in ${occurrence.chapterTitle}: ${occurrence.path || "the start"}`,
      icon: <Repeat />,
      divided: index === 0,
      onSelect: () => props.onOpenOccurrence(occurrence)
    }))
  ];
}

/** Promote the variation, delete the line from the move. */
function editItems(props: MoveMenuProps): (MenuItem | false)[] {
  const { node, canPromote } = props;
  return [
    canPromote && {
      label: "Promote variation",
      icon: <ArrowUpToLine />,
      divided: true,
      onSelect: props.onPromote
    },
    Boolean(node.uci) && {
      label: `Delete from ${node.san ?? "here"}`,
      icon: <Trash2 />,
      destructive: true,
      divided: !canPromote,
      onSelect: props.onDelete
    }
  ];
}

/** The selected position's pause, its unsaved change first. */
export function usePausedAt(
  repertoireId: string,
  positionKey: string | null,
  stored: boolean
): boolean {
  const draft = useRepertoireWorkspaceStore((state): DecisionTextDraft | undefined =>
    positionKey
      ? state.decisionDrafts[decisionDraftKey(repertoireId, positionKey, "paused")]
      : undefined
  );
  return draft?.paused ?? stored;
}
