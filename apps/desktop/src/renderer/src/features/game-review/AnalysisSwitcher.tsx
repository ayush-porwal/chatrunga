import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Trash2 } from "lucide-react";
import {
  reviewInfoDetails,
  reviewInfoLabel,
  reviewInfoWhen
} from "@chaturanga/shared/chess/review-info";
import type { SavedReviewInfo } from "@chaturanga/shared/types/chess";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePresence } from "@/components/ui/use-presence";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { frost, popover } from "@/lib/ui";
import { useDismiss } from "@/lib/use-dismiss";
import { cn } from "@/lib/utils";
import { useDeleteAnalysesMutation } from "../../queries/api";
import { useGameStore } from "../../stores/game-store";
import { useReviewStore } from "../../stores/review-store";
import { shownAnalysisId, showAfterAnalysesDeleted, showSavedAnalysis } from "../game/saved-game";

/** What the confirmation is about: one analysis, or every one of the game. */
type PendingDelete = { reviewId: string } | "all";

const OPTION_SELECTOR = "[data-analysis-option]";

/**
 * The game's saved analyses in Game review's titlebar: a compact button naming the one shown (its
 * date, and Latest when it's the newest; the rest in its tooltip) that opens the list to switch
 * between them (each with its own AI commentary) or delete them, after a confirmation. Locked
 * while a review runs.
 */
export function AnalysisSwitcher() {
  const analyses = useReviewStore((state) => state.analyses);
  const review = useReviewStore((state) => state.review);
  const running = useReviewStore((state) => state.status === "running");
  const gameId = useGameStore((state) => state.gameId);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const deleteAnalyses = useDeleteAnalysesMutation();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const { present, state } = usePresence(open);

  const close = useCallback(() => {
    // Escape (or a click outside) from inside the list hands focus back to the button.
    if (rootRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
    setOpen(false);
  }, []);
  useDismiss(rootRef, open, close);

  // Opening moves focus to the analysis shown, so the arrow keys start there.
  useEffect(() => {
    if (!open) return;
    const options = [...(listRef.current?.querySelectorAll<HTMLElement>(OPTION_SELECTOR) ?? [])];
    (options.find((option) => option.getAttribute("aria-current") === "true") ?? options[0])?.focus(
      { preventScroll: true }
    );
  }, [open]);

  const locked = running || loading || deleteAnalyses.isPending;
  if (!analyses.length || !gameId) return null;

  const shownId = shownAnalysisId(analyses, review);
  const shownIndex = analyses.findIndex((info) => info.reviewId === shownId);
  const shown = analyses[shownIndex];

  const choose = (reviewId: string) => {
    close();
    if (reviewId === shownId) return;
    setLoading(true);
    void showSavedAnalysis(gameId, reviewId)
      .catch(() => false)
      .finally(() => setLoading(false));
  };

  const askToDelete = (target: PendingDelete) => {
    // The confirmation hands focus back to the button when it closes.
    triggerRef.current?.focus();
    setOpen(false);
    deleteAnalyses.reset();
    setPendingDelete(target);
  };

  const confirmDelete = async (target: PendingDelete) => {
    try {
      await deleteAnalyses.mutateAsync({
        gameId,
        reviewId: target === "all" ? null : target.reviewId
      });
    } catch {
      // The dialog stays open and says why.
      return;
    }
    setPendingDelete(null);
    setLoading(true);
    try {
      await showAfterAnalysesDeleted(gameId, target === "all" ? "all" : [target.reviewId]);
    } finally {
      setLoading(false);
    }
  };

  // Up and Down move between the analyses (Tab still reaches each one's delete button).
  const onOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const options = [...(listRef.current?.querySelectorAll<HTMLElement>(OPTION_SELECTOR) ?? [])];
    if (!options.length) return;
    event.preventDefault();
    const current = options.indexOf(event.currentTarget);
    const step = event.key === "ArrowDown" ? 1 : -1;
    const next = current < 0 ? 0 : (current + step + options.length) % options.length;
    options[next]?.focus();
  };

  return (
    <div ref={rootRef} className="relative inline-flex">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            ref={triggerRef}
            type="button"
            variant="outline"
            size="sm"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-label={shown ? `Analysis: ${triggerName(shown, shownIndex === 0)}` : "Analyses"}
            disabled={locked}
            onClick={() => (open ? close() : setOpen(true))}
            className="max-w-56 tabular-nums"
          >
            {shown ? (
              <>
                <span className="min-w-0 truncate">{reviewInfoWhen(shown)}</span>
                {shownIndex === 0 ? <LatestTag /> : null}
              </>
            ) : (
              <span className="min-w-0 truncate">Analyses</span>
            )}
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "text-fg-subtle transition-transform duration-standard ease-standard",
                open && "rotate-180"
              )}
            />
          </Button>
        </TooltipTrigger>
        {open ? null : (
          <TooltipContent side="bottom">
            {shown
              ? `${shownIndex === 0 ? "Latest · " : ""}${reviewInfoLabel(shown)}`
              : "Saved analyses of this game"}
          </TooltipContent>
        )}
      </Tooltip>

      {present ? (
        <div
          role="dialog"
          aria-label="Saved analyses"
          data-state={state}
          className={cn(
            "absolute right-0 top-[calc(100%+4px)] z-50 w-80 max-w-[calc(100vw-2rem)] [-webkit-app-region:no-drag]",
            state === "closed" && "pointer-events-none"
          )}
        >
          <span
            aria-hidden="true"
            data-state={state}
            className={cn(frost, "rounded-lg animate-fade-in data-[state=closed]:animate-fade-out")}
          />
          <div
            ref={listRef}
            data-state={state}
            className={cn(
              popover,
              "relative grid max-h-[min(24rem,70vh)] origin-top-right gap-0.5 overflow-y-auto"
            )}
          >
            {analyses.map((info, index) => (
              <AnalysisRow
                key={info.reviewId}
                info={info}
                latest={index === 0}
                selected={info.reviewId === shownId}
                hidden={state === "closed"}
                onChoose={() => choose(info.reviewId)}
                onKeyDown={onOptionKeyDown}
                onDelete={() => askToDelete({ reviewId: info.reviewId })}
              />
            ))}
            <Separator className="my-1" />
            <button
              type="button"
              tabIndex={state === "closed" ? -1 : undefined}
              onClick={() => askToDelete("all")}
              className="flex h-8 items-center gap-2 whitespace-nowrap rounded-md px-2 text-left text-sm text-danger outline-none transition-colors hover:bg-danger-soft focus-visible:bg-danger-soft [&_svg]:size-4 [&_svg]:shrink-0"
            >
              <Trash2 aria-hidden="true" />
              Delete all analyses of this game
            </button>
          </div>
        </div>
      ) : null}

      {pendingDelete ? (
        <Dialog
          size="sm"
          title={
            pendingDelete === "all"
              ? `Delete all ${analyses.length} ${analyses.length === 1 ? "analysis" : "analyses"} of this game?`
              : "Delete this analysis?"
          }
          description="This can't be undone."
          onClose={deleteAnalyses.isPending ? undefined : () => setPendingDelete(null)}
          footer={
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={deleteAnalyses.isPending}
                onClick={() => setPendingDelete(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="ghost-destructive"
                size="sm"
                disabled={deleteAnalyses.isPending}
                onClick={() => void confirmDelete(pendingDelete)}
              >
                <Trash2 />
                {pendingDelete === "all" ? "Delete all" : "Delete"}
              </Button>
            </>
          }
        >
          {deleteAnalyses.error ? (
            <p className="text-sm text-danger" role="alert">
              {ipcErrorMessage(deleteAnalyses.error) || "The analysis couldn't be deleted."}
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </div>
  );
}

/** One saved analysis in the list: when (and Latest), how it was made, and its delete button. */
function AnalysisRow({
  info,
  latest,
  selected,
  hidden,
  onChoose,
  onKeyDown,
  onDelete
}: {
  info: SavedReviewInfo;
  latest: boolean;
  selected: boolean;
  /** The list is closing: its buttons leave the Tab order. */
  hidden: boolean;
  onChoose: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onDelete: () => void;
}) {
  const when = reviewInfoWhen(info);
  return (
    <div className="group/row flex items-center gap-1 rounded-md transition-colors hover:bg-control focus-within:bg-control">
      <button
        type="button"
        data-analysis-option
        aria-current={selected ? "true" : undefined}
        tabIndex={hidden ? -1 : undefined}
        onClick={onChoose}
        onKeyDown={onKeyDown}
        className="flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
      >
        <Check
          aria-hidden="true"
          className={cn("mt-0.5 size-4 shrink-0 text-accent-fg", !selected && "invisible")}
        />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5 text-sm text-fg tabular-nums">
            <span className="truncate">{when}</span>
            {latest ? <LatestTag /> : null}
          </span>
          <span className="truncate text-xs text-fg-muted">{reviewInfoDetails(info)}</span>
        </span>
      </button>
      <IconButton
        label={`Delete the analysis of ${when}`}
        icon={<Trash2 />}
        size="icon-xs"
        tabIndex={hidden ? -1 : undefined}
        tooltipSide="right"
        onClick={onDelete}
        className="mr-1 shrink-0 text-fg-muted opacity-0 hover:text-danger focus-visible:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100"
      />
    </div>
  );
}

function LatestTag() {
  return (
    <Badge tone="accent" className="font-medium">
      Latest
    </Badge>
  );
}

/** The trigger's accessible name: what it shows, `Oct 4, 4:01 PM, Latest`. */
function triggerName(info: SavedReviewInfo, latest: boolean): string {
  return `${reviewInfoWhen(info)}${latest ? ", Latest" : ""}`;
}
