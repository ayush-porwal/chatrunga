import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  Globe,
  ListFilter,
  Loader2,
  Search,
  SquareDashed,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { GAME_SEARCH_MAX_LENGTH, type GameSource } from "@chaturanga/shared/types/chess";
import {
  LIBRARY_TAB_LABELS,
  libraryTabOf,
  type LibraryTab
} from "@chaturanga/shared/types/library";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { usePresence } from "@/components/ui/use-presence";
import { frost, popover } from "@/lib/ui";
import { useDismiss } from "@/lib/use-dismiss";
import { cn } from "@/lib/utils";
import { DESTINATION_ICONS } from "../../app/destination-icons";
import type { RecentGamesFilterOption } from "./recent-games";

/** Each source's mark. The app has no Lichess or Chess.com logos: both online sites are a globe. */
const SOURCE_ICONS: Record<LibraryTab, LucideIcon> = {
  lichess: Globe,
  chesscom: Globe,
  imported: DESTINATION_ICONS.importPgn,
  engine: Bot,
  chaturanga: SquareDashed
};

/**
 * Where a game came from, as a small round badge in its thumbnail's bottom-right corner. Its ring
 * takes the row's colour (hovered or not), so it reads as cut out of the board. `className` moves
 * or sizes it (the Library's badge hangs off the thumbnail's corner).
 */
export function SourceBadge({ source, className }: { source: GameSource; className?: string }) {
  const tab = libraryTabOf(source);
  const label = LIBRARY_TAB_LABELS[tab];
  const Icon = SOURCE_ICONS[tab];
  return (
    // Above the row's whole-row button, so its name shows on hover.
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "absolute bottom-1 right-1 z-10 grid size-4 place-items-center rounded-full bg-control text-fg-muted ring-2 ring-surface transition-colors duration-micro group-hover/row:bg-control-hover group-hover/row:ring-control group-focus-within/row:bg-control-hover group-focus-within/row:ring-control",
        className
      )}
    >
      <Icon aria-hidden="true" className="size-2.5" strokeWidth={2.25} />
    </span>
  );
}

/** A title-bar button's "on" mark (a filter or search applies): a dot at its icon's top-right. */
export function ActiveDot() {
  return (
    <span
      aria-hidden="true"
      className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-accent ring-2 ring-surface transition-colors duration-micro group-hover/dot:ring-control"
    />
  );
}

/** An on/off row under the filter's sources (the Library's Reviewed), with its count. */
export type RecentGamesFilterToggle = {
  label: string;
  count: number;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

/**
 * The source filter: a funnel opening a menu of "All games" and each source with games (with its
 * count), the chosen one checked, then (when given) `toggle` under a divider. The funnel carries a
 * dot while a source is chosen or the toggle is on. `heading` titles the menu's sources;
 * `className` styles the funnel.
 */
export function RecentGamesFilter({
  options,
  value,
  onChange,
  toggle,
  heading,
  className
}: {
  options: readonly RecentGamesFilterOption[];
  value: LibraryTab | null;
  onChange: (tab: LibraryTab | null) => void;
  toggle?: RecentGamesFilterToggle;
  heading?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);
  useMenuEscape(open, close);
  const { present, state } = usePresence(open);
  const applied = [value ? LIBRARY_TAB_LABELS[value] : null, toggle?.checked ? toggle.label : null]
    .filter(Boolean)
    .join(" · ");
  const label = applied ? `Filter: ${applied}` : "Filter games";
  // A choice closes the menu, then applies.
  const choose = (select: () => void) => () => {
    setOpen(false);
    select();
  };
  const closed = state === "closed";

  return (
    <div ref={rootRef} className="relative inline-flex">
      <IconButton
        label={label}
        icon={
          <>
            <ListFilter />
            {applied ? <ActiveDot /> : null}
          </>
        }
        className={cn("group/dot relative", className)}
        aria-haspopup="menu"
        aria-expanded={open}
        tooltip={!open}
        onClick={() => setOpen((on) => !on)}
      />
      {present ? (
        <div
          role="menu"
          aria-label="Show games from"
          data-state={state}
          className={cn(
            "absolute right-0 top-[calc(100%+4px)] z-50 min-w-48",
            state === "closed" && "pointer-events-none"
          )}
        >
          <span
            aria-hidden="true"
            data-state={state}
            className={cn(frost, "rounded-lg animate-fade-in data-[state=closed]:animate-fade-out")}
          />
          <div data-state={state} className={cn(popover, "relative grid gap-0.5 origin-top-right")}>
            {heading ? (
              <span aria-hidden="true" className="px-2 pb-1 pt-2 text-[0.6875rem] text-fg-subtle">
                {heading}
              </span>
            ) : null}
            {options.map((option) => (
              <FilterMenuItem
                key={option.tab ?? "all"}
                itemRole="menuitemradio"
                checked={option.tab === value}
                text={option.label}
                count={option.count}
                closed={closed}
                onSelect={choose(() => onChange(option.tab))}
              />
            ))}
            {toggle ? (
              <>
                <span aria-hidden="true" className="mx-1.5 my-1 h-px bg-line-subtle" />
                <FilterMenuItem
                  key="toggle"
                  itemRole="menuitemcheckbox"
                  checked={toggle.checked}
                  text={toggle.label}
                  count={toggle.count}
                  closed={closed}
                  onSelect={choose(() => toggle.onChange(!toggle.checked))}
                />
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * While `open`, Escape closes the menu alone: caught on the way down (capture) and marked handled,
 * so a dialog around the menu (which ignores a handled Escape) stays open for the next one.
 */
function useMenuEscape(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [open, close]);
}

/** One of the filter menu's choices: a tick while it applies, its label and its game count. */
function FilterMenuItem({
  itemRole,
  checked,
  text,
  count,
  closed,
  onSelect
}: {
  /** A source to show (one of them), or a filter on top (on or off). */
  itemRole: "menuitemradio" | "menuitemcheckbox";
  checked: boolean;
  text: string;
  count: number;
  /** The menu is closing: its items leave the tab order. */
  closed: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role={itemRole}
      aria-checked={checked}
      tabIndex={closed ? -1 : undefined}
      onClick={onSelect}
      className="flex h-8 items-center gap-2 whitespace-nowrap rounded-md px-2 text-left text-sm text-fg-secondary outline-none transition-colors hover:bg-control hover:text-fg focus-visible:bg-control"
    >
      <span className="grid size-4 shrink-0 place-items-center text-accent">
        {checked ? <Check aria-hidden="true" className="size-4" /> : null}
      </span>
      <span className="flex-1">{text}</span>
      <span className="pl-4 text-xs tabular-nums text-fg-subtle">{count}</span>
    </button>
  );
}

/**
 * Search, folded into a magnifier until opened: then a field (✕ or Esc clears it and folds it
 * back, focus returning to the magnifier). Leaving the field with text in it folds it too; the
 * search still applies, and the magnifier carries a dot. `label` names it ("Search games").
 */
export function RecentGamesSearch({
  query,
  onQueryChange,
  label = "Search games"
}: {
  query: string;
  onQueryChange: (query: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const refocus = useRef(false);

  // The magnifier mounts again on close: focus it once it is there.
  useEffect(() => {
    if (open || !refocus.current) return;
    refocus.current = false;
    buttonRef.current?.focus();
  }, [open]);

  function clearAndClose() {
    onQueryChange("");
    refocus.current = true;
    setOpen(false);
  }

  if (!open) {
    const active = query.trim() !== "";
    return (
      <IconButton
        ref={buttonRef}
        label={active ? `Search: ${query.trim()}` : label}
        icon={
          <>
            <Search />
            {active ? <ActiveDot /> : null}
          </>
        }
        className="group/dot relative"
        onClick={() => setOpen(true)}
      />
    );
  }

  return (
    <div className="relative w-60 animate-fade-in">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle"
      />
      <Input
        // It mounts only when the user opens search.
        autoFocus
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          // The field's own Escape: nothing else (a dialog, the page) should take it too.
          event.preventDefault();
          event.stopPropagation();
          clearAndClose();
        }}
        onBlur={() => setOpen(false)}
        maxLength={GAME_SEARCH_MAX_LENGTH}
        aria-label={label}
        placeholder={label}
        className="h-8 pl-8 pr-8 [&::-webkit-search-cancel-button]:hidden"
      />
      <IconButton
        label="Clear search"
        icon={<X />}
        size="icon-xs"
        tooltip={false}
        className="absolute right-1 top-1/2 size-6 -translate-y-1/2"
        // Keep the field focused (its blur would fold it before this click lands).
        onMouseDown={(event) => event.preventDefault()}
        onClick={clearAndClose}
      />
    </div>
  );
}

/** Row actions: quiet until the row is hovered or holds focus (an open menu counts as both). */
export const dimmedUntilRowHover =
  "inline-flex opacity-55 transition-opacity duration-micro group-hover/row:opacity-100 group-focus-within/row:opacity-100 has-[[aria-expanded=true]]:opacity-100";

/**
 * The "Load more games" pill at a list's end: a spinner while the next page loads (`loading`).
 */
export function LoadMoreGamesButton({
  loading,
  disabled,
  onClick
}: {
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button type="button" size="sm" className="rounded-full" disabled={disabled} onClick={onClick}>
      {loading ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <ChevronDown />}
      Load more games
    </Button>
  );
}

/** Reviewed: a board with two filled squares (the analysis is there to open). */
export function ChessboardIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 12h18M12 3v18" />
      <rect x="3" y="3" width="9" height="9" rx="1.5" fill="currentColor" stroke="none" />
      <rect x="12" y="12" width="9" height="9" rx="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
