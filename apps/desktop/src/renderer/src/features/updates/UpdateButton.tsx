import { memo, useCallback, useEffect, useRef, useState, type FocusEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, Check, CircleAlert, CircleArrowUp, Download, ExternalLink, RefreshCw, RotateCw } from "lucide-react";
import type { UpdateState } from "@chaturanga/shared/types/updates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePresence } from "@/components/ui/use-presence";
import {
  formatReleaseDate,
  updateAction,
  updateButtonView,
  updateCardAction,
  type CheckFeedback,
  type UpdateButtonView
} from "@/lib/app-update";
import { isElectronMac } from "@/lib/environment";
import { checkForUpdates, runUpdateAction, useAppUpdate } from "@/lib/use-app-update";
import { useMinuteClock } from "@/lib/use-minute-clock";
import { floatingSurface, frost, well } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { ReleaseNotes } from "./ReleaseNotes";

const CARD_OPEN_DELAY_MS = 150;
const CARD_CLOSE_DELAY_MS = 220;
const FEEDBACK_MS = 2600;
const CARD_GAP_PX = 10;

/**
 * Sidebar footer button next to Settings (below it on the collapsed rail).
 *
 * - No update: click checks for updates. The icon spins while checking (pulses under reduced
 *   motion); the tooltip shows "Last checked …", and after a check the user started, a check mark
 *   and "You're up to date · v0.1.0" (or the error) for a moment.
 * - Update available / downloading / ready: accent icon with a dot (a progress ring while
 *   downloading). Hover or keyboard focus opens the changelog card; a click pins it (touch / click
 *   users). Esc or a click outside closes it. The card holds the one action: "Restart to update",
 *   "Downloading… 42%" (disabled) or "Download v0.2.0" (downloads off, or the unsigned-macOS path,
 *   which opens the installer in the browser).
 * - Development builds: dimmed, "Updates work in installed builds".
 */
export const UpdateButton = memo(function UpdateButton({
  tooltipSide,
  className
}: {
  tooltipSide: "top" | "right";
  className?: string;
}) {
  const state = useAppUpdate();
  const now = useMinuteClock();
  const [feedback, setFeedback] = useState<CheckFeedback>(null);
  const [tipOpen, setTipOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const openTimer = useRef(0);
  const closeTimer = useRef(0);
  const feedbackTimer = useRef(0);

  const view = updateButtonView(state, feedback, now);
  // The tooltip is off while there's an update (the card replaces it), so Radix never reports a
  // close then (it only reports changes from the `open` it is given): a hover then must not leave
  // it "open", or it would show unasked once the update goes away (a failed download).
  if (view.hasUpdate && tipOpen) setTipOpen(false);
  const cardOpen = view.hasUpdate && anchor !== null && (hovered || pinned);
  const { present, state: presence } = usePresence(cardOpen);

  const clearTimers = () => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
  };
  /** Anchors the card beside the button (measured when it opens; a resize closes it). */
  const measure = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ left: rect.right + CARD_GAP_PX, bottom: Math.max(8, window.innerHeight - rect.bottom) });
  };
  const hoverIn = () => {
    if (!view.hasUpdate) return;
    clearTimers();
    openTimer.current = window.setTimeout(
      () => {
        measure();
        setHovered(true);
      },
      cardOpen ? 0 : CARD_OPEN_DELAY_MS
    );
  };
  const hoverOut = () => {
    clearTimers();
    closeTimer.current = window.setTimeout(() => setHovered(false), CARD_CLOSE_DELAY_MS);
  };
  const closeCard = useCallback(() => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    setHovered(false);
    setPinned(false);
  }, []);

  // Esc, a press outside the button and card, or a window resize closes the card.
  useEffect(() => {
    if (!cardOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !cardRef.current?.contains(target)) closeCard();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const hadFocus = cardRef.current?.contains(document.activeElement);
      closeCard();
      if (hadFocus) buttonRef.current?.focus();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", closeCard);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", closeCard);
    };
  }, [cardOpen, closeCard]);

  useEffect(
    () => () => {
      window.clearTimeout(openTimer.current);
      window.clearTimeout(closeTimer.current);
      window.clearTimeout(feedbackTimer.current);
    },
    []
  );

  const showFeedback = (kind: Exclude<CheckFeedback, null>) => {
    window.clearTimeout(feedbackTimer.current);
    setFeedback(kind);
    feedbackTimer.current = window.setTimeout(() => setFeedback(null), FEEDBACK_MS);
  };

  const onClick = async (event: MouseEvent<HTMLButtonElement>) => {
    if (view.visual === "disabled" || view.visual === "checking") return;
    if (view.hasUpdate) {
      if (pinned) {
        closeCard();
        return;
      }
      measure();
      setPinned(true);
      // Keyboard activation (detail 0): move into the card so its action is one Tab/Enter away.
      if (event.detail === 0) window.requestAnimationFrame(() => cardRef.current?.focus());
      return;
    }
    setFeedback(null);
    const next = await checkForUpdates();
    const kind = next?.status.kind;
    if (kind === "up-to-date" || kind === "error") showFeedback(kind);
    else if (next && updateAction(next.status)) {
      // A check the user asked for found an update: show it right away.
      measure();
      setPinned(true);
    }
  };

  const onFocus = (event: FocusEvent<HTMLButtonElement>) => {
    if (view.hasUpdate && event.currentTarget.matches(":focus-visible")) {
      measure();
      setHovered(true);
    }
  };
  const onBlur = (event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && (buttonRef.current?.contains(next) || cardRef.current?.contains(next))) return;
    if (!pinned) setHovered(false);
  };

  const disabled = view.visual === "disabled";
  const accent = view.hasUpdate;

  return (
    <>
      <Tooltip open={!view.hasUpdate && (tipOpen || feedback !== null)} onOpenChange={(open) => setTipOpen(open && !view.hasUpdate)}>
        <TooltipTrigger asChild>
          <Button
            ref={buttonRef}
            type="button"
            variant="ghost"
            size="icon"
            aria-label={view.label}
            aria-disabled={disabled || undefined}
            aria-haspopup={view.hasUpdate ? "dialog" : undefined}
            aria-expanded={view.hasUpdate ? cardOpen : undefined}
            onClick={(event) => void onClick(event)}
            onPointerEnter={hoverIn}
            onPointerLeave={hoverOut}
            onFocus={onFocus}
            onBlur={onBlur}
            className={cn(
              "relative text-fg-secondary [-webkit-app-region:no-drag] hover:bg-control hover:text-fg aria-expanded:bg-control",
              accent && "text-accent hover:text-accent aria-expanded:text-accent",
              disabled && "cursor-default text-fg-subtle hover:bg-transparent hover:text-fg-subtle active:scale-100",
              className
            )}
          >
            <UpdateIcon view={view} />
          </Button>
        </TooltipTrigger>
        {view.hasUpdate ? null : (
          <TooltipContent side={tooltipSide} className="max-w-64">
            <span className="grid gap-0.5">
              <span className={cn(view.visual === "up-to-date" && "text-accent-fg")}>{view.label}</span>
              {view.detail ? <span className="text-fg-muted">{view.detail}</span> : null}
            </span>
          </TooltipContent>
        )}
      </Tooltip>
      {present && anchor && state
        ? createPortal(
            <div
              ref={cardRef}
              role="dialog"
              aria-label={view.label}
              tabIndex={-1}
              data-state={presence}
              onPointerEnter={hoverIn}
              onPointerLeave={hoverOut}
              onBlur={onBlur}
              className={cn("fixed z-[80] w-[min(21.25rem,calc(100vw-80px))] outline-none", presence === "closed" && "pointer-events-none")}
              style={{ left: anchor.left, bottom: anchor.bottom }}
            >
              <span aria-hidden="true" data-state={presence} className={cn(frost, "rounded-xl animate-fade-in data-[state=closed]:animate-fade-out")} />
              <ChangelogCard state={state} presence={presence} onBrowserOpened={closeCard} />
            </div>,
            document.body
          )
        : null}
    </>
  );
});

function UpdateIcon({ view }: { view: UpdateButtonView }) {
  switch (view.visual) {
    case "checking":
      return <RefreshCw className="animate-spin motion-reduce:animate-pulse" aria-hidden="true" />;
    case "up-to-date":
      return <Check key="done" className="animate-pop-in text-accent" aria-hidden="true" />;
    case "error":
      return <CircleAlert key="error" className="animate-pop-in text-warn" aria-hidden="true" />;
    case "downloading": {
      // A 20px ring filling with the download; the arrow sits inside it.
      const circumference = 2 * Math.PI * 8.5;
      return (
        <span className="relative grid size-5 place-items-center" aria-hidden="true">
          <svg viewBox="0 0 20 20" className="absolute inset-0 size-5! -rotate-90">
            <circle cx="10" cy="10" r="8.5" fill="none" strokeWidth="1.75" className="stroke-line-strong" />
            <circle
              cx="10"
              cy="10"
              r="8.5"
              fill="none"
              strokeWidth="1.75"
              strokeLinecap="round"
              className="stroke-accent transition-[stroke-dashoffset] duration-emphasis ease-standard"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - (view.percent ?? 0) / 100)}
            />
          </svg>
          <ArrowDown className="size-3!" />
        </span>
      );
    }
    case "update":
    case "ready":
      return (
        <span className="relative grid place-items-center" aria-hidden="true">
          <CircleArrowUp />
          <span className="absolute -right-1 -top-1 size-2 animate-pop-in rounded-full bg-accent ring-2 ring-chrome glass:ring-transparent" />
        </span>
      );
    default:
      return <RefreshCw aria-hidden="true" />;
  }
}

function ChangelogCard({
  state,
  presence,
  onBrowserOpened
}: {
  state: UpdateState;
  presence: "open" | "closed";
  /** The manual download went to the browser: the card has done its job. */
  onBrowserOpened: () => void;
}) {
  const status = state.status;
  const card = updateCardAction(status);
  if (!("version" in status) || !card) return null;
  const date = "releaseDate" in status ? formatReleaseDate(status.releaseDate) : null;
  const notes = "notes" in status ? status.notes : "";
  const hint =
    status.kind === "manual"
      ? isElectronMac()
        ? "Opens the installer in your browser. Drag the new app into Applications."
        : "Opens the download in your browser."
      : status.kind === "ready"
        ? "Chaturanga restarts to finish. Your games are saved."
        : null;
  const action = card.action;

  return (
    <div
      data-state={presence}
      className={cn(
        "relative grid origin-bottom-left gap-3 rounded-xl border border-line p-4 shadow-popover",
        // A text card that can sit over the board: the frosted fill, nearly opaque for legibility.
        floatingSurface,
        "glass:bg-surface-raised/95",
        "animate-pop-in data-[state=closed]:animate-pop-out"
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <h2 className="text-sm font-semibold text-fg">Chaturanga v{status.version}</h2>
          <p className="text-xs text-fg-muted">{[date, `You have v${state.currentVersion}`].filter(Boolean).join(" · ")}</p>
        </div>
        <Badge tone="accent">{status.kind === "ready" ? "Ready" : "New"}</Badge>
      </header>
      <div className={cn(well, "scroll-area max-h-[min(15rem,45vh)] overflow-y-auto px-3 py-2.5")}>
        <ReleaseNotes notes={notes} className="gap-1.5 text-xs leading-5" />
      </div>
      <div className="grid gap-2">
        {status.kind === "downloading" ? <Progress value={status.percent} aria-label={`Downloading version ${status.version}`} /> : null}
        <Button
          variant="primary"
          className="w-full"
          disabled={!action}
          onClick={() => {
            if (!action) return;
            void runUpdateAction(action);
            if (action === "open-download") onBrowserOpened();
          }}
        >
          {action === "install" ? <RotateCw /> : action === "open-download" ? <ExternalLink /> : <Download />}
          {card.label}
        </Button>
        {hint ? <p className="text-center text-2xs leading-4 text-fg-subtle">{hint}</p> : null}
      </div>
    </div>
  );
}
