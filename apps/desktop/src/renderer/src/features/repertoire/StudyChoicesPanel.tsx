import { useMemo } from "react";
import { Ban, BookOpen, Check, CircleSlash, PauseCircle, Repeat, Star } from "lucide-react";
import type { ChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import type {
  RepertoireChapter,
  RepertoireColor,
  RepertoireDecision,
  RepertoireNodeMeta,
  RepertoireOccurrence
} from "@chaturanga/shared/types/repertoire";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/page";
import { BoundaryControls } from "./StudyBoundaryControls";
import {
  CHOICE_LABELS,
  choiceActions,
  deriveChoices,
  pathLabel,
  transpositionsOf,
  type ChoiceAction,
  type ChoiceRow,
  type ChoiceState
} from "./repertoire-model";

const STATE_ICONS: Record<ChoiceState, typeof Star> = {
  preferred: Star,
  accepted: Check,
  covered: Check,
  reference: BookOpen,
  untrained: CircleSlash
};

const ACTION_LABELS: Record<ChoiceAction["kind"], string> = {
  accept: "Accept",
  prefer: "Prefer",
  "make-reference": "Make reference",
  cover: "Cover"
};

const STATE_TONES: Record<ChoiceState, "accent" | "info" | "neutral"> = {
  preferred: "accent",
  accepted: "info",
  covered: "info",
  reference: "neutral",
  untrained: "neutral"
};

/**
 * Below the move tree: the choices at the selected position (Preferred / Accepted / Reference at
 * the player's move, Covered / Reference at the opponent's), the training boundaries of the
 * selected move with their effect on this chapter's decisions, and where else the position occurs.
 * States always carry a text label and an icon, never colour alone.
 */
export function StudyChoicesPanel({
  chapter,
  lookup,
  color,
  selectedNodeId,
  decision,
  busy,
  onSetEdge,
  onPrefer,
  onSetMeta,
  onSelectNode,
  otherOccurrences,
  onOpenOccurrence,
  onRehearseFromHere
}: {
  chapter: RepertoireChapter;
  lookup: ChapterLookup;
  color: RepertoireColor;
  selectedNodeId: string;
  decision: Pick<RepertoireDecision, "acceptedUcis" | "preferredUci" | "paused"> | null;
  busy: boolean;
  onSetEdge: (nodeId: string, edge: RepertoireNodeMeta["edge"]) => void;
  onPrefer: (row: ChoiceRow) => void;
  onSetMeta: (nodeId: string, patch: Partial<RepertoireNodeMeta>) => void;
  onSelectNode: (nodeId: string) => void;
  /** Where this position is reached in the repertoire's other chapters. */
  otherOccurrences: readonly RepertoireOccurrence[];
  onOpenOccurrence: (occurrence: RepertoireOccurrence) => void;
  /** "Rehearse from here": line rehearsal starting at the selected move (absent: unavailable). */
  onRehearseFromHere?: () => void;
}) {
  const choices = useMemo(
    () => deriveChoices(chapter, lookup, selectedNodeId, color, decision),
    [chapter, lookup, selectedNodeId, color, decision]
  );
  const transpositions = useMemo(
    () => transpositionsOf(lookup, selectedNodeId),
    [lookup, selectedNodeId]
  );
  const isRoot = selectedNodeId === "root";
  /** The first continuation in the chapter's order: its authored main line (PGN export's). */
  const mainLineId = lookup.childrenById.get(selectedNodeId)?.[0] ?? null;

  return (
    <div className="grid gap-4">
      <section aria-label="Choices at this position" className="grid gap-2">
        <SectionHeader
          as="h3"
          title={choices.side === "player" ? "Your choices here" : "Replies you prepare for"}
          actions={
            choices.side === "player" && decision?.paused ? (
              <Badge tone="warn" title="Left out of practice everywhere it occurs (see Notes)">
                <PauseCircle aria-hidden="true" />
                Paused in practice
              </Badge>
            ) : null
          }
          description={
            choices.side === "player"
              ? "Any accepted move counts as correct in practice; hints point at the preferred one. Main line is only the chapter's move order (as PGN export writes it)."
              : "Covered replies continue into training; reference replies are study only. Main line is only the chapter's move order (as PGN export writes it)."
          }
        />
        {choices.rows.length ? (
          <ul className="grid gap-1">
            {choices.rows.map((row) => (
              <ChoiceItem
                key={row.nodeId}
                row={row}
                side={choices.side}
                mainLine={row.nodeId === mainLineId && choices.rows.length > 1}
                busy={busy}
                onSelect={() => onSelectNode(row.nodeId)}
                onSetEdge={(edge) => onSetEdge(row.nodeId, edge)}
                onPrefer={() => onPrefer(row)}
              />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-fg-muted">
            No moves from here yet — play one on the board to add it.
          </p>
        )}
      </section>

      {transpositions.length || otherOccurrences.length ? (
        <section aria-label="Transpositions" className="grid gap-1.5">
          <p className="flex items-center gap-1.5 text-xs font-medium text-fg-secondary">
            <Repeat className="size-3.5" aria-hidden="true" />
            Also reached
          </p>
          <ul className="grid gap-1">
            {otherOccurrences.slice(0, 8).map((occurrence) => (
              <li key={`${occurrence.chapterId}:${occurrence.nodeId}`}>
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  className="h-auto whitespace-normal text-left"
                  onClick={() => onOpenOccurrence(occurrence)}
                >
                  <span>
                    In {occurrence.chapterTitle}:{" "}
                    <span className="font-mono">{occurrence.path || "the start"}</span>
                  </span>
                </Button>
              </li>
            ))}
            {transpositions.slice(0, 5).map((nodeId) => (
              <li key={nodeId}>
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  className="font-mono"
                  onClick={() => onSelectNode(nodeId)}
                >
                  This chapter: {pathLabel(lookup, nodeId)}
                </Button>
              </li>
            ))}
          </ul>
          <p className="text-2xs text-fg-subtle">
            A preferred move, prompt, hint, wrong-move feedback or pause applies to every occurrence
            of this position.
          </p>
        </section>
      ) : null}

      {isRoot ? null : (
        <BoundaryControls
          chapter={chapter}
          color={color}
          nodeId={selectedNodeId}
          onSetMeta={onSetMeta}
          onRehearseFromHere={onRehearseFromHere}
        />
      )}
    </div>
  );
}

function ChoiceItem({
  row,
  side,
  mainLine,
  busy,
  onSelect,
  onSetEdge,
  onPrefer
}: {
  row: ChoiceRow;
  side: "player" | "opponent";
  /** First in the chapter's order (shown only when there are alternatives). */
  mainLine: boolean;
  busy: boolean;
  onSelect: () => void;
  onSetEdge: (edge: RepertoireNodeMeta["edge"]) => void;
  onPrefer: () => void;
}) {
  const Icon = STATE_ICONS[row.state];
  return (
    <li className="flex min-h-9 items-center gap-2 rounded-lg border border-line-subtle bg-surface-sunken px-2 py-1">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="min-w-14 justify-start font-mono"
        onClick={onSelect}
      >
        {row.san}
      </Button>
      <Badge tone={STATE_TONES[row.state]}>
        <Icon aria-hidden="true" />
        {CHOICE_LABELS[row.state]}
      </Badge>
      {row.state === "untrained" ? (
        <span className="text-2xs text-fg-subtle">
          {row.edge === "reference" ? "reference" : side === "player" ? "accepted" : "covered"}
        </span>
      ) : null}
      {mainLine ? (
        <span
          className="whitespace-nowrap text-2xs text-fg-subtle"
          title="First in this chapter's move order, as PGN export writes it. Promote variation changes it; it doesn't change what practice expects."
        >
          main line
        </span>
      ) : null}
      {row.disabled ? (
        <Badge tone="warn">
          <Ban aria-hidden="true" />
          Disabled
        </Badge>
      ) : null}
      <div className="ml-auto flex items-center gap-1">
        {choiceActions(row, side).map((action) => (
          <Button
            key={action.kind}
            type="button"
            variant={action.variant}
            size="xs"
            disabled={busy}
            onClick={() =>
              action.kind === "prefer"
                ? onPrefer()
                : onSetEdge(
                    action.kind === "accept"
                      ? "included"
                      : action.kind === "cover"
                        ? "covered"
                        : "reference"
                  )
            }
          >
            {ACTION_LABELS[action.kind]}
          </Button>
        ))}
      </div>
    </li>
  );
}
