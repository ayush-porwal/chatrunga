import { Fragment, useMemo, type ReactNode } from "react";
import { CornerUpLeft, GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  resolveCommentaryMoves,
  tokenizeCommentary,
  type CommentaryMoveContext,
  type MoveNavigationTarget
} from "./commentary-moves";

export type GoToLine = (target: MoveNavigationTarget) => void;

/** An inline move that jumps the board, move tree and graph to its position. */
export function MoveLink({
  san,
  children,
  onActivate,
  className
}: {
  san: string;
  children?: ReactNode;
  onActivate: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={`Go to ${san} position`}
      title={`Go to ${san}`}
      onClick={onActivate}
      className={cn(
        "cursor-pointer rounded-sm text-accent underline-offset-[3px] outline-none transition-colors hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-accent/40",
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
    () => (context && onGoToLine ? resolveCommentaryMoves(segments, context) : new Map()),
    [context, onGoToLine, segments]
  );
  return (
    <>
      {segments.map((segment, position) => {
        if (segment.kind === "text") return <Fragment key={position}>{segment.text}</Fragment>;
        const target = resolved.get(segment.index);
        if (!target || !onGoToLine) return <Fragment key={position}>{segment.text}</Fragment>;
        return (
          <MoveLink key={position} san={target.san} onActivate={() => onGoToLine({ startNodeId: target.startNodeId, moves: target.moves })}>
            {segment.text}
          </MoveLink>
        );
      })}
    </>
  );
}

/** A SAN line ("Qb3 Bc5 Bxf7+") where each move is a link to the position after it. */
export function MoveLine({
  startNodeId,
  sans,
  onGoToLine,
  empty = "No line returned",
  linkClassName
}: {
  startNodeId: string | null;
  sans: readonly string[];
  onGoToLine?: GoToLine;
  empty?: string;
  linkClassName?: string;
}) {
  if (!sans.length) return <>{empty}</>;
  if (!startNodeId || !onGoToLine) return <>{sans.join(" ")}</>;
  return (
    <>
      {sans.map((san, index) => (
        <Fragment key={`${index}-${san}`}>
          {index ? " " : null}
          <MoveLink san={san} className={linkClassName} onActivate={() => onGoToLine({ startNodeId, moves: sans.slice(0, index + 1) })} />
        </Fragment>
      ))}
    </>
  );
}

/** "Exploring a variation from 6…Nf6 · Back to game" — shown while the board is off the reviewed line. */
export function VariationAnchorNote({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs text-fg-muted" role="status">
      <GitBranch className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
      <span>
        Exploring a variation from <span className="font-mono text-fg-secondary">{label}</span>
      </span>
      <span aria-hidden className="text-fg-subtle">·</span>
      <button
        type="button"
        onClick={onBack}
        className="inline-flex cursor-pointer items-center gap-1 rounded-sm text-accent underline-offset-[3px] outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <CornerUpLeft className="size-3" aria-hidden />
        Back to game
      </button>
    </p>
  );
}
