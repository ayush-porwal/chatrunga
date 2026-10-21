import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Trash2 } from "lucide-react";
import {
  reviewInfoBrief,
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
import { EngineAvatar } from "../analysis/EngineAvatar";
import { useReviewStore } from "../../stores/review-store";
import { shownAnalysisId, showAfterAnalysesDeleted, showSavedAnalysis } from "../game/saved-game";

/** What the confirmation is about: one analysis, or every one of the game. */
type PendingDelete = { reviewId: string } | "all";

const OPTION_SELECTOR = "[data-analysis-option]";

/**
 * The button's and its list's one width, compact (the list sits right-aligned under it: the same
 * edges). Each row reads in it without truncating: its date, Latest, and engine and search.
 */
const PICKER_WIDTH = "w-60 max-w-[calc(100vw-1rem)]";

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
  const menuRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [dismissRoots] = useState(() => [rootRef, menuRef] as const);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const { present, state } = usePresence(open);
  const headingId = useId();

  const close = useCallback(() => {
    // Escape (or a click outside) from inside the list hands focus back to the button.
    if (menuRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
    setOpen(false);
  }, []);
  useDismiss(dismissRoots, open, close);

  // The list is portalled to the body (the review panel and board paint over anything left in the
  // titlebar's stacking context), so it is placed under the button, right-aligned, by measuring.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = triggerRef.current;
      if (trigger) setAnchor(menuAnchor(trigger.getBoundingClientRect()));
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  // Opening moves focus to the analysis shown, so the arrow keys start there (once the list is
  // placed: the first opening renders it only after measuring).
  const placed = anchor !== null;
  useEffect(() => {
    if (!open || !placed) return;
    const options = [...(listRef.current?.querySelectorAll<HTMLElement>(OPTION_SELECTOR) ?? [])];
    (
      options.find((option) => option.getAttribute("aria-current") === "true") ?? options.at(0)
    )?.focus({ preventScroll: true });
  }, [open, placed]);

  const locked = running || loading || deleteAnalyses.isPending;
  if (!analyses.length || !gameId) return null;

  const shownId = shownAnalysisId(analyses, review);
  const shownIndex = analyses.findIndex((info) => info.reviewId === shownId);
  const shown = shownIndex >= 0 ? analyses[shownIndex] : null;

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
      <SwitcherTrigger
        ref={triggerRef}
        shown={shown}
        latest={shownIndex === 0}
        open={open}
        disabled={locked}
        onClick={() => (open ? close() : setOpen(true))}
      />

      {present && anchor
        ? createPortal(
            <div
              ref={menuRef}
              role="dialog"
              aria-labelledby={headingId}
              data-state={state}
              // z-50 like every popover; a confirmation opened from it is portalled after it, so on top.
              className={cn(
                "fixed z-50 [-webkit-app-region:no-drag]",
                PICKER_WIDTH,
                state === "closed" && "pointer-events-none"
              )}
              style={{ top: anchor.top, right: anchor.right }}
            >
              <span
                aria-hidden="true"
                data-state={state}
                className={cn(
                  frost,
                  "rounded-lg animate-fade-in data-[state=closed]:animate-fade-out"
                )}
              />
              <div
                ref={listRef}
                data-state={state}
                className={cn(popover, "relative grid origin-top-right gap-0.5 overflow-y-auto")}
                style={{ maxHeight: anchor.maxHeight }}
              >
                <p id={headingId} className="px-2 pt-1 pb-0.5 text-xs text-fg-subtle">
                  Saved analyses
                </p>
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
                  Delete all analyses
                </button>
              </div>
            </div>,
            document.body
          )
        : null}

      {pendingDelete ? (
        <DeleteAnalysesDialog
          target={pendingDelete}
          count={analyses.length}
          deleting={deleteAnalyses.isPending}
          error={deleteAnalyses.error}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void confirmDelete(pendingDelete)}
        />
      ) : null}
    </div>
  );
}

/**
 * The titlebar's button: the analysis shown (its date, and Latest when it's the newest; the rest
 * in its tooltip, hidden while the list is open).
 */
function SwitcherTrigger({
  ref,
  shown,
  latest,
  open,
  disabled,
  onClick
}: {
  ref: Ref<HTMLButtonElement>;
  shown: SavedReviewInfo | null;
  latest: boolean;
  open: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={ref}
          type="button"
          variant="outline"
          size="sm"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={shown ? `Analysis: ${triggerName(shown, latest)}` : "Analyses"}
          disabled={disabled}
          onClick={onClick}
          // The list's width whatever the entry: it never jumps, and lines up with the list. Pressed
          // while the list is open.
          className={cn(
            PICKER_WIDTH,
            "justify-between tabular-nums",
            open && "border-line-strong bg-control text-fg"
          )}
        >
          <span className="min-w-0 truncate">{shown ? reviewInfoWhen(shown) : "Analyses"}</span>
          {/* Latest at the right end, beside the chevron. */}
          <span className="flex shrink-0 items-center gap-2">
            {shown && latest ? <LatestTag /> : null}
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "text-fg-subtle transition-transform duration-standard ease-standard",
                open && "rotate-180"
              )}
            />
          </span>
        </Button>
      </TooltipTrigger>
      {open ? null : (
        <TooltipContent side="bottom">
          {shown
            ? `${latest ? "Latest · " : ""}${reviewInfoLabel(shown)}`
            : "Saved analyses of this game"}
        </TooltipContent>
      )}
    </Tooltip>
  );
}

/**
 * Confirms deleting one analysis, or all of the game's (`count`); it stays open while that runs,
 * and says why when it failed.
 */
function DeleteAnalysesDialog({
  target,
  count,
  deleting,
  error,
  onCancel,
  onConfirm
}: {
  target: PendingDelete;
  count: number;
  deleting: boolean;
  error: unknown;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      size="sm"
      title={
        target === "all"
          ? `Delete all ${count} ${count === 1 ? "analysis" : "analyses"} of this game?`
          : "Delete this analysis?"
      }
      description="This can't be undone."
      onClose={deleting ? undefined : onCancel}
      footer={
        <>
          <Button type="button" variant="outline" size="sm" disabled={deleting} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="ghost-destructive"
            size="sm"
            disabled={deleting}
            onClick={onConfirm}
          >
            <Trash2 />
            {target === "all" ? "Delete all" : "Delete"}
          </Button>
        </>
      }
    >
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {ipcErrorMessage(error) || "The analysis couldn't be deleted."}
        </p>
      ) : null}
    </Dialog>
  );
}

/**
 * One saved analysis in the list: when (and Latest), its engine (picture and name) and search, and
 * its delete button. Everything else about how it was made (Maia levels, AI comments) is in its
 * tooltip.
 */
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
  const label = reviewInfoLabel(info);
  return (
    <div className="flex items-center gap-1 rounded-md transition-colors hover:bg-control focus-within:bg-control">
      <button
        type="button"
        data-analysis-option
        aria-current={selected ? "true" : undefined}
        tabIndex={hidden ? -1 : undefined}
        title={label}
        onClick={onChoose}
        onKeyDown={onKeyDown}
        // Two lines; the check's column holds the engine's picture on the second, so the picture
        // costs no width.
        className="grid min-w-0 flex-1 grid-cols-[1rem_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
      >
        <Check
          aria-hidden="true"
          className={cn("size-4 text-accent-fg", !selected && "invisible")}
        />
        {/* Latest at the right end, as on the button. */}
        <span className="flex min-w-0 items-center justify-between gap-1.5 text-sm text-fg tabular-nums">
          <span className="truncate">{when}</span>
          {latest ? <LatestTag /> : null}
        </span>
        {info.engineName ? (
          <EngineAvatar engine={{ name: info.engineName }} size="xs" className="size-4" />
        ) : (
          <span aria-hidden="true" />
        )}
        <span className="truncate text-xs text-fg-muted">{reviewInfoBrief(info)}</span>
      </button>
      <IconButton
        label={`Delete the analysis of ${when}`}
        icon={<Trash2 />}
        size="icon-xs"
        tabIndex={hidden ? -1 : undefined}
        tooltipSide="right"
        onClick={onDelete}
        className="mr-1 shrink-0 text-fg-subtle hover:text-danger"
      />
    </div>
  );
}

/** Where the portalled list sits: under the button, right edges aligned, inside the window. */
type MenuAnchor = { top: number; right: number; maxHeight: number };

const MENU_GAP = 4;
const WINDOW_MARGIN = 8;

function menuAnchor(
  trigger: Pick<DOMRect, "bottom" | "right">,
  viewport: { width: number; height: number } = {
    width: window.innerWidth,
    height: window.innerHeight
  }
): MenuAnchor {
  const top = trigger.bottom + MENU_GAP;
  return {
    top,
    right: Math.max(WINDOW_MARGIN, viewport.width - trigger.right),
    maxHeight: Math.max(120, Math.min(384, viewport.height - top - WINDOW_MARGIN))
  };
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
