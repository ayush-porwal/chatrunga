import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A section the user can fold away, remembered per section (localStorage, per viewer: a blocked or
 * empty store just starts at `defaultOpen`). The panel's multi-part screens use it: the review
 * summary's sections, the review charts, the review settings' groups. One header for all of them:
 * a left chevron and the title (⌄ Opening), as the charts' "Winning chances".
 *
 *   const section = useCollapsible("review-summary:opening");
 *   <CollapsibleHeader open={section.open} onToggle={section.toggle} controls={section.contentId}>
 *     Opening
 *   </CollapsibleHeader>
 *   <CollapsibleBody section={section} className="grid gap-2">…</CollapsibleBody>
 *
 * Or both at once: <CollapsibleSection storageKey=… title="Opening">…</CollapsibleSection>.
 * The header is a button with aria-expanded / aria-controls; a folded body isn't rendered (its
 * element stays, `hidden`, so aria-controls always points at it).
 */

const STORAGE_PREFIX = "chaturanga:collapsed:";

function readOpen(storageKey: string, defaultOpen: boolean): boolean {
  try {
    const stored = window.localStorage.getItem(STORAGE_PREFIX + storageKey);
    return stored === null ? defaultOpen : stored !== "1";
  } catch {
    return defaultOpen;
  }
}

function writeOpen(storageKey: string, open: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + storageKey, open ? "0" : "1");
  } catch {
    // Storage unavailable: the section still folds, for this session only.
  }
}

/**
 * Opens (or folds) a section ahead of its showing, as if the user had: a link that leads to it
 * (the review's opening handoff unfolding the repertoire comparison).
 */
export function rememberCollapsibleOpen(storageKey: string, open: boolean): void {
  writeOpen(storageKey, open);
}

export type Collapsible = {
  open: boolean;
  toggle: () => void;
  setOpen: (open: boolean) => void;
  /** The body's id (the header's aria-controls). */
  contentId: string;
};

/** A section's open state, remembered under `storageKey`. */
export function useCollapsible(storageKey: string, defaultOpen = true): Collapsible {
  const [open, setOpenState] = React.useState(() => readOpen(storageKey, defaultOpen));
  const contentId = React.useId();
  const setOpen = React.useCallback(
    (next: boolean) => {
      setOpenState(next);
      writeOpen(storageKey, next);
    },
    [storageKey]
  );
  const toggle = React.useCallback(() => {
    setOpenState((current) => {
      writeOpen(storageKey, !current);
      return !current;
    });
  }, [storageKey]);
  return { open, toggle, setOpen, contentId };
}

/**
 * The two header sizes. `section`: a panel's own sections (Game Review, the charts): a roomy 48px
 * row, the title at 15px medium, a 15px muted chevron, controls 10px apart. `sub`: sections inside
 * one (the summary's Accuracy / Opening / …, a dialog's groups): the same chevron and weight,
 * scaled down.
 */
export type CollapsibleSize = "section" | "sub";

const TOGGLE_TITLE: Record<CollapsibleSize, string> = {
  section: "text-[15px] leading-6 font-medium text-fg",
  sub: "text-sm leading-5 font-medium text-fg"
};
const TOGGLE_CHEVRON: Record<CollapsibleSize, string> = {
  section: "size-[15px]",
  sub: "size-3.5"
};
const HEADER_ROW: Record<CollapsibleSize, string> = {
  section: "min-h-12 gap-2.5 pl-1",
  sub: "min-h-7 gap-2"
};
const ACTIONS_GAP: Record<CollapsibleSize, string> = { section: "gap-2.5", sub: "gap-2" };

/**
 * The section's toggle: a heading whose button is a muted chevron at its LEFT and the title
 * (⌄ Opening while open, › Opening folded). Use it alone where the row holds more.
 */
export function CollapsibleToggle({
  open,
  onToggle,
  controls,
  size = "sub",
  className,
  children
}: {
  open: boolean;
  onToggle: () => void;
  /** The body's id (aria-controls). */
  controls: string;
  size?: CollapsibleSize;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <h3 className={cn(TOGGLE_TITLE[size], "min-w-0", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={controls}
        onClick={onToggle}
        className="flex min-w-0 items-center gap-1.5 rounded-sm outline-none transition-colors duration-micro ease-standard hover:text-fg-secondary focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        <ChevronDown
          aria-hidden
          className={cn(
            TOGGLE_CHEVRON[size],
            "shrink-0 text-fg-subtle transition-transform duration-micro ease-standard",
            !open && "-rotate-90"
          )}
        />
        <span className="truncate">{children}</span>
      </button>
    </h3>
  );
}

/**
 * A section's header row: the toggle at the left, `actions` (outside the button) at the right,
 * vertically centred and 10px apart (a settings gear, when there is one, last). Every folding
 * section uses this one row, so they share height and spacing.
 */
export function CollapsibleHeader({
  open,
  onToggle,
  controls,
  size = "section",
  actions,
  className,
  children
}: {
  open: boolean;
  onToggle: () => void;
  controls: string;
  size?: CollapsibleSize;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(collapsibleHeaderRow, HEADER_ROW[size], className)}>
      <CollapsibleToggle open={open} onToggle={onToggle} controls={controls} size={size}>
        {children}
      </CollapsibleToggle>
      {actions ? (
        <div className={cn("flex min-w-0 items-center", ACTIONS_GAP[size])}>{actions}</div>
      ) : null}
    </div>
  );
}

/** The header row's box (its height and spacing come with its size), for a row laid out by its owner. */
export const collapsibleHeaderRow = "flex shrink-0 items-center justify-between";

/** The section's body: rendered only while open. */
export function CollapsibleBody({
  section,
  className,
  children,
  ...props
}: {
  section: Collapsible;
  className?: string;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "id" | "hidden" | "className" | "children">) {
  return (
    <div {...props} id={section.contentId} hidden={!section.open} className={className}>
      {section.open ? children : null}
    </div>
  );
}

/** A header and its body, remembered under `storageKey` (see the file comment). */
export function CollapsibleSection({
  storageKey,
  title,
  size = "section",
  defaultOpen = true,
  actions,
  className,
  headerClassName,
  bodyClassName,
  children
}: {
  storageKey: string;
  title: React.ReactNode;
  size?: CollapsibleSize;
  defaultOpen?: boolean;
  actions?: React.ReactNode;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  const section = useCollapsible(storageKey, defaultOpen);
  return (
    <div className={className}>
      <CollapsibleHeader
        open={section.open}
        onToggle={section.toggle}
        controls={section.contentId}
        size={size}
        actions={actions}
        className={headerClassName}
      >
        {title}
      </CollapsibleHeader>
      <CollapsibleBody section={section} className={bodyClassName}>
        {children}
      </CollapsibleBody>
    </div>
  );
}
