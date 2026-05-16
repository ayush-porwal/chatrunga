import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { useGameStore } from "../../stores/game-store";
import { useReviewStore, reviewByNode, partialReviewByNode } from "../../stores/review-store";
import { formatEngineScore, reviewLabel } from "@chaturanga/shared/chess/review";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type { MoveReview } from "@chaturanga/shared/types/engine";
import { cn } from "@/lib/utils";
import { empty, gamePanelScrollBody } from "@/lib/ui";

type RenderCtx = {
  nodeMap: Map<string, MoveNode>;
  currentNodeId: string;
  goToNode: (id: string) => void;
  deleteLineFromNode: (id: string) => boolean;
  reviews: Map<string, MoveReview>;
};

function moveNumberLabel(ply: number, kind: "white" | "black-start"): string {
  if (kind === "white") return `${Math.floor(ply / 2) + 1}.`;
  return `${Math.floor(ply / 2)}\u2026`;
}

function renderLine(startId: string, ctx: RenderCtx, lineStart: boolean): ReactNode[] {
  const parts: ReactNode[] = [];
  let nodeId: string | undefined = startId;
  let needLineStart = lineStart;

  while (nodeId) {
    const node = ctx.nodeMap.get(nodeId);
    if (!node) break;

    const isWhite = node.ply % 2 === 1;
    if (isWhite) {
      parts.push(
        <span key={`mn-${node.id}`} className="mx-1 text-[11.5px] font-medium text-[#707070] select-none">
          {moveNumberLabel(node.ply, "white")}
        </span>
      );
    } else if (needLineStart) {
      parts.push(
        <span key={`mn-${node.id}`} className="mx-1 text-[11.5px] font-medium text-[#707070] select-none">
          {moveNumberLabel(node.ply, "black-start")}
        </span>
      );
    }
    needLineStart = false;

    const isActive = node.id === ctx.currentNodeId;
    const review = ctx.reviews.get(node.id);
    const badge = review ? badgeForReview(review) : "";
    const title = review
      ? `${reviewLabel(review.classification)} · ${formatEngineScore(review.evalAfter)}`
      : undefined;
    parts.push(
      <span key={node.id} className="inline-flex items-center gap-0.5 align-baseline">
        <button
          type="button"
          className={cn(
            "ply inline-flex items-center gap-1 rounded-[5px] border-0 bg-transparent px-1.5 py-px text-sm font-medium leading-normal text-inherit transition-colors hover:bg-white/[0.07] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#6c9a6b]",
            isActive && "ply--active bg-[#5a7d42] text-white hover:bg-[#5a7d42]"
          )}
          title={title}
          onClick={() => ctx.goToNode(node.id)}
        >
          <span>{node.san}</span>
          {badge ? (
            <span
              className={cn(
                "min-w-[13px] rounded-[3px] px-[3px] text-center text-[10px] font-bold leading-tight",
                badgeClass(review?.classification)
              )}
            >
              {badge}
            </span>
          ) : null}
        </button>
        {isActive ? (
          <button
            type="button"
            className="inline-flex h-5 w-5 items-center justify-center rounded bg-white/[0.07] p-0 text-[#d2d2d2] opacity-80 transition-colors hover:bg-[#7d3430] hover:text-white hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#c96a60]"
            title="Delete this line"
            aria-label={`Delete line from ${node.san ?? "selected move"}`}
            onClick={() => {
              if (window.confirm("Delete this move and all following moves in this line?")) {
                ctx.deleteLineFromNode(node.id);
              }
            }}
          >
            <Trash2 aria-hidden="true" size={13} strokeWidth={2.2} />
          </button>
        ) : null}
      </span>
    );

    const variations = node.children.slice(1);
    for (const vid of variations) {
      parts.push(
        <div key={`var-${vid}`} className="my-1 ml-1 block border-l-2 border-[#3a3f45] py-px pl-3 text-[13px] leading-relaxed text-[#b9bec5]">
          {renderLine(vid, ctx, true)}
        </div>
      );
    }
    if (variations.length > 0) needLineStart = true;

    nodeId = node.children[0];
  }
  return parts;
}

export function MoveList() {
  const moveTree = useGameStore((s) => s.moveTree);
  const currentNodeId = useGameStore((s) => s.currentNodeId);
  const goToNode = useGameStore((s) => s.goToNode);
  const deleteLineFromNode = useGameStore((s) => s.deleteLineFromNode);
  const review = useReviewStore((s) => s.review);
  const partialMoves = useReviewStore((s) => s.partialMoves);
  const nodeMap = useMemo(() => {
    const m = new Map<string, MoveNode>();
    for (const n of moveTree) m.set(n.id, n);
    return m;
  }, [moveTree]);
  const reviews = useMemo(
    () => (review ? reviewByNode(review) : partialReviewByNode(partialMoves)),
    [review, partialMoves]
  );
  const root = nodeMap.get("root");
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const active = container?.querySelector(".ply--active") as HTMLElement | null;
    if (!container || !active) return;
    const containerRect = container.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const padding = 12;
    if (activeRect.top < containerRect.top + padding) {
      container.scrollTop -= containerRect.top + padding - activeRect.top;
    } else if (activeRect.bottom > containerRect.bottom - padding) {
      container.scrollTop += activeRect.bottom - (containerRect.bottom - padding);
    }
  }, [currentNodeId, moveTree]);

  if (!root?.children.length) {
    return <p className={empty}>No moves yet.</p>;
  }

  const ctx: RenderCtx = { nodeMap, currentNodeId, goToNode, deleteLineFromNode, reviews };
  const mainStart = root.children[0];
  const rootVariations = root.children.slice(1);

  return (
    <div
      ref={containerRef}
      className={cn(gamePanelScrollBody, "text-sm leading-[1.9] text-[#ececec] tabular-nums")}
      aria-label="Game moves"
    >
      <div className="block">
        {mainStart ? renderLine(mainStart, ctx, true) : null}
        {rootVariations.map((vid) => (
          <div key={`rvar-${vid}`} className="my-1 ml-1 block border-l-2 border-[#3a3f45] py-px pl-3 text-[13px] leading-relaxed text-[#b9bec5]">
            {renderLine(vid, ctx, true)}
          </div>
        ))}
      </div>
    </div>
  );
}

function badgeClass(classification: MoveReview["classification"] | undefined): string {
  switch (classification) {
    case "best":
    case "excellent":
      return "bg-[#2f6b55] text-[#e7fff4]";
    case "inaccuracy":
      return "bg-[#7a6730] text-[#fff1bd]";
    case "mistake":
    case "blunder":
    case "missed_tactic":
      return "bg-[#843f3a] text-[#ffe8e5]";
    default:
      return "bg-[#343434] text-[#d8d8d8]";
  }
}

function badgeForReview(review: MoveReview): string {
  switch (review.classification) {
    case "best":
      return "!";
    case "excellent":
      return "!!";
    case "good":
      return "";
    case "inaccuracy":
      return "?!";
    case "mistake":
      return "?";
    case "blunder":
      return "??";
    case "missed_tactic":
      return "T";
  }
}
