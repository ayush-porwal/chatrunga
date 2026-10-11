import { Fragment, useMemo, type ReactNode } from "react";
import { CornerUpLeft, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/utils";
import {
  resolveCommentaryMoves,
  tokenizeCommentary,
  type CommentaryMoveContext,
  type CommentarySegment,
  type MoveNavigationTarget
} from "./commentary-moves";

const NO_LINKS: ReturnType<typeof resolveCommentaryMoves> = new Map();

export type GoToLine = (target: MoveNavigationTarget) => void;

type ResolvedMoves = ReturnType<typeof resolveCommentaryMoves>;

/**
 * Resolved links per (context, prose): revisiting a move — or the panel remounting for it — reuses
 * the result instead of replaying every candidate line again.
 */
const resolvedCache = new WeakMap<CommentaryMoveContext, Map<string, ResolvedMoves>>();

function resolveCached(
  prose: string,
  segments: readonly CommentarySegment[],
  context: CommentaryMoveContext
): ResolvedMoves {
  let byProse = resolvedCache.get(context);
  if (!byProse) {
    byProse = new Map();
    resolvedCache.set(context, byProse);
  }
  let resolved = byProse.get(prose);
  if (!resolved) {
    resolved = resolveCommentaryMoves(segments, context);
    byProse.set(prose, resolved);
  }
  return resolved;
}

/** An inline move that jumps the board, move tree and graph to its position. */
export function MoveLink({
  san,
  children,
  onActivate,
  className,
  nativeTitle = true,
  label
}: {
  san: string;
  children?: ReactNode;
  onActivate: () => void;
  className?: string;
  /** What activating it does, for assistive tech (default: going to the move's position). */
  label?: string;
  /** The browser's "Go to …" hint; off where the position itself shows on hover (engine lines). */
  nativeTitle?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label ?? `Go to ${san} position`}
      title={nativeTitle ? `Go to ${san}` : undefined}
      onClick={onActivate}
      className={cn(
        // The tint and underline fade in; the padding is paid back by the negative margin so the
        // prose never shifts on hover.
        "-mx-[2px] cursor-pointer rounded-[3px] px-[2px] text-accent underline decoration-transparent decoration-1 underline-offset-[3px] outline-none",
        "transition-[background-color,text-decoration-color,color] duration-micro ease-standard",
        "hover:bg-accent/12 hover:decoration-current focus-visible:bg-accent/12 focus-visible:decoration-current focus-visible:ring-2 focus-visible:ring-accent/50",
        className
      )}
    >
      {children ?? san}
    </button>
  );
}

/** Commentary prose with every resolvable SAN token rendered as a `MoveLink`. */
export function CommentaryProse({
  prose,
  context,
  onGoToLine
}: {
  prose: string;
  context: CommentaryMoveContext | null;
  onGoToLine?: GoToLine;
}) {
  const segments = useMemo(() => tokenizeCommentary(prose), [prose]);
  const resolved = useMemo(
    () => (context && onGoToLine ? resolveCached(prose, segments, context) : NO_LINKS),
    [context, onGoToLine, prose, segments]
  );
  return (
    <>
      {segments.map((segment, position) => {
        if (segment.kind === "text") return <Fragment key={position}>{segment.text}</Fragment>;
        const target = resolved.get(segment.index);
        if (!target || !onGoToLine) return <Fragment key={position}>{segment.text}</Fragment>;
        return (
          <MoveLink
            key={position}
            san={target.san}
            onActivate={() => onGoToLine({ startNodeId: target.startNodeId, moves: target.moves })}
          >
            {segment.text}
          </MoveLink>
        );
      })}
    </>
  );
}

/**
 * "Exploring a variation from 6… ♘f6" with Back to game, as an info band: shown while the board is
 * off the reviewed line (the panel then shows the move the variation leaves the game from).
 */
export function VariationAnchorNote({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <Notice
      tone="info"
      icon={<GitBranch />}
      className="items-center"
      action={
        <Button variant="ghost" size="xs" onClick={onBack}>
          <CornerUpLeft />
          Back to game
        </Button>
      }
    >
      Exploring a variation from <span className="font-mono text-fg">{label}</span>
    </Notice>
  );
}
