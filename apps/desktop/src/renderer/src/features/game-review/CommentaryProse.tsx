import { Fragment, useMemo, type ReactNode } from "react";
import type { Square } from "@chaturanga/shared/types/chess";
import { useBoardPreview, type BoardPreview } from "./board-preview";
import {
  bareSquareOf,
  resolveCommentaryMoves,
  tokenizeCommentary,
  type CommentaryMoveContext,
  type CommentarySegment
} from "./commentary-moves";
import { MoveLink, type GoToLine } from "./MoveLinks";

const NO_LINKS: ReturnType<typeof resolveCommentaryMoves> = new Map();

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

/**
 * A square the prose names, marked as a reference (not a control): the pointer resting on it, or
 * keyboard focus, rings it on Game review's board in the position the text is about.
 */
function SquareRef({
  square,
  fen,
  children
}: {
  square: Square;
  fen: string;
  children: ReactNode;
}) {
  const preview = useMemo<BoardPreview>(() => ({ kind: "square", fen, square }), [fen, square]);
  const { handlers } = useBoardPreview(preview);
  return (
    <span
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- focus shows the square on the board, as the pointer resting on it does
      tabIndex={0}
      data-square-ref={square}
      className="-mx-[2px] rounded-[3px] px-[2px] underline decoration-fg-subtle/60 decoration-dotted decoration-1 underline-offset-[3px] outline-none transition-colors duration-micro ease-standard hover:bg-fg/8 focus-visible:bg-fg/8 focus-visible:ring-2 focus-visible:ring-accent/50"
      {...handlers}
    >
      {children}
    </span>
  );
}

/**
 * Commentary prose with every resolvable SAN token rendered as a `MoveLink` (resting on one shows
 * the move on the board) and every square it names as a square reference (resting on one rings the
 * square in the position the commentary is about: before the reviewed move).
 */
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
        const square = segment.kind === "square" ? segment.square : null;
        const target = segment.kind === "move" ? resolved.get(segment.index) : undefined;
        if (target && onGoToLine) {
          return (
            <MoveLink
              key={position}
              san={target.san}
              preview={{ kind: "move", fen: target.fenBefore, uci: target.uci }}
              onActivate={() =>
                onGoToLine({ startNodeId: target.startNodeId, moves: target.moves })
              }
            >
              {segment.text}
            </MoveLink>
          );
        }
        // A bare square that isn't a move here ("control of d5") is a square too.
        const named = square ?? (segment.kind === "move" ? bareSquareOf(segment) : null);
        if (named && context) {
          return (
            <SquareRef key={position} square={named} fen={context.move.fenBefore}>
              {segment.text}
            </SquareRef>
          );
        }
        return <Fragment key={position}>{segment.text}</Fragment>;
      })}
    </>
  );
}
