import { Fragment, useMemo, type ReactNode } from "react";
import { CornerUpLeft, GitBranch } from "lucide-react";
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

function resolveCached(prose: string, segments: readonly CommentarySegment[], context: CommentaryMoveContext): ResolvedMoves {
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
  nativeTitle = true
}: {
  san: string;
  children?: ReactNode;
  onActivate: () => void;
  className?: string;
  /** The browser's "Go to …" hint; off where the position itself shows on hover (engine lines). */
  nativeTitle?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={`Go to ${san} position`}
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
        className="inline-flex cursor-pointer items-center gap-1 rounded-sm text-accent underline decoration-transparent underline-offset-[3px] outline-none transition-[text-decoration-color] duration-micro ease-standard hover:decoration-current focus-visible:decoration-current focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        <CornerUpLeft className="size-3" aria-hidden />
        Back to game
      </button>
    </p>
  );
}
