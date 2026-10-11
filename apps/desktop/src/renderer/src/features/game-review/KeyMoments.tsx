import { memo, useId, useMemo, useState } from "react";
import { ChevronDown, KeyRound, MessageSquareOff } from "lucide-react";
import type { MoveReview } from "@chaturanga/shared/types/engine";
import type { KeyMoment } from "@chaturanga/shared/chess/key-moments";
import { annotationLabel } from "@chaturanga/shared/chess/move-assessment";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { annotationTone, listRowSelected } from "@/lib/ui";
import { cn } from "@/lib/utils";
import {
  useOpenRouterConfigQuery,
  useSettingsQuery,
  useUpdateSettingMutation
} from "../../queries/api";
import { moveLabel } from "./review-utils";
import { momentCommentaryPrompt } from "./review-summary";
import { MomentCommentary, useCardCommentary } from "./MomentCommentary";
import { Figurine } from "../board/Figurine";
import { MoveMarkDisc } from "../board/MoveMarkDisc";
import { useBoardAppearance } from "../board/useBoardAppearance";
import { bareSan, sanPiece } from "../game/move-list-model";

/**
 * The key moments as cards (the reviewed side's strongest marked moves), one row each: the mark's
 * disc, the move with the board's piece, and the mark's name. Selecting a card goes to that move.
 * With AI commentary on, each card is an accordion item: its chevron (at the right) opens the
 * move's commentary (the Commentary tab's own) inside the card, one card open at a time. With it
 * off, cards hold no text beyond the move and mark, and don't open.
 */
export const MomentList = memo(function MomentList({
  moments,
  moves,
  selectedNodeId,
  onSelectNode,
  label,
  emptyTitle,
  className
}: {
  moments: readonly KeyMoment[];
  moves: readonly MoveReview[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  /** Accessible name of the list. */
  label: string;
  emptyTitle: string;
  className?: string;
}) {
  const byNode = useMemo(() => new Map(moves.map((move) => [move.nodeId, move])), [moves]);
  const commentary = useCardCommentary();
  const { pieceClassName } = useBoardAppearance();
  // The one open card (accordion): opening another closes it.
  const [openId, setOpenId] = useState<string | null>(null);
  const bodyIds = useId();
  if (!moments.length) return <EmptyState compact title={emptyTitle} />;
  return (
    <ol
      aria-label={label}
      // The board's piece set, so each move's piece is the board's own (as in the move list).
      className={cn("cg-wrap grid gap-1.5", pieceClassName, className)}
      // Unlayered `.cg-wrap` rules (display: block, board.css inline-size containment) would lay this out.
      style={{ display: "grid", containerType: "normal" }}
    >
      {moments.map((moment) => {
        const move = byNode.get(moment.nodeId);
        if (!move) return null;
        const selected = moment.nodeId === selectedNodeId;
        const open = Boolean(commentary) && openId === moment.nodeId;
        const bodyId = `${bodyIds}-${moment.nodeId}`;
        return (
          <li
            key={moment.nodeId}
            className={cn(
              "overflow-hidden rounded-lg border border-line bg-surface transition-colors duration-micro",
              selected && listRowSelected
            )}
          >
            <button
              type="button"
              aria-label={`${moveLabel(move)}, ${annotationLabel(moment.annotation)}`}
              aria-current={selected ? "step" : undefined}
              aria-expanded={commentary ? open : undefined}
              aria-controls={commentary ? bodyId : undefined}
              className="flex min-h-10 w-full items-center gap-2.5 px-3 py-1.5 text-left outline-none transition-colors duration-micro hover:bg-control/60 focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-inset"
              onClick={() => {
                if (commentary) setOpenId(open ? null : moment.nodeId);
                onSelectNode(moment.nodeId);
              }}
            >
              <MoveMarkDisc annotation={moment.annotation} decorative />
              <span className="flex min-w-0 items-baseline gap-1 text-sm font-semibold text-fg">
                <span className="font-medium text-fg-subtle">{moveNumberLabel(move.ply)}</span>
                <span className="inline-flex items-baseline">
                  <Figurine role={sanPiece(move.san)} />
                  {bareSan(move.san)}
                </span>
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-xs font-medium",
                  annotationTone[moment.annotation].text
                )}
              >
                {annotationLabel(moment.annotation)}
              </span>
              {commentary ? (
                <ChevronDown
                  aria-hidden
                  className={cn(
                    "size-3.5 shrink-0 text-fg-subtle transition-transform duration-micro ease-standard",
                    open && "rotate-180"
                  )}
                />
              ) : null}
            </button>
            {commentary ? (
              <div id={bodyId} hidden={!open} className="px-3 pt-0.5 pb-3">
                {open ? <MomentCommentary move={move} moves={moves} options={commentary} /> : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
});

/**
 * Under the key moments while their cards can't open: the one step that lets them explain each
 * moment (switch AI commentary on, or add an OpenRouter key). Nothing while AI commentary is on,
 * or until the settings and the key's state have loaded.
 */
export function MomentCommentaryPrompt({ onAddKey }: { onAddKey?: () => void }) {
  const cardsOn = useCardCommentary() !== null;
  const settings = useSettingsQuery();
  const openRouter = useOpenRouterConfigQuery();
  const { mutate: updateSetting } = useUpdateSettingMutation();
  const prompt = momentCommentaryPrompt({
    cardsOn,
    enabled: settings.data?.reviewCommentaryEnabled,
    hasApiKey: openRouter.data?.hasApiKey
  });
  if (!prompt) return null;
  const off = prompt === "off";
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-line-subtle px-3 py-2 text-xs text-fg-muted [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-fg-subtle">
      {off ? <MessageSquareOff aria-hidden /> : <KeyRound aria-hidden />}
      <span className="min-w-0 flex-1">
        {off
          ? "Turn on AI commentary to have each moment explained."
          : "Add an OpenRouter key to have each moment explained."}
      </span>
      {off ? (
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => updateSetting({ key: "reviewCommentaryEnabled", value: true })}
        >
          Turn on
        </Button>
      ) : onAddKey ? (
        <Button type="button" variant="primary" size="xs" onClick={onAddKey}>
          Add API key
        </Button>
      ) : null}
    </div>
  );
}

/** "4." before White's move, "4…" before Black's. */
function moveNumberLabel(ply: number): string {
  const number = Math.ceil(ply / 2);
  return ply % 2 === 1 ? `${number}.` : `${number}…`;
}
