import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Check, Globe, ListFilter, Search, SquareDashed, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { GAME_SEARCH_MAX_LENGTH, type GameSource } from "@chaturanga/shared/types/chess";
import {
  LIBRARY_TAB_LABELS,
  libraryTabOf,
  type LibraryTab
} from "@chaturanga/shared/types/library";
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
 * takes the row's colour (hovered or not), so it reads as cut out of the board.
 */
export function SourceBadge({ source }: { source: GameSource }) {
  const tab = libraryTabOf(source);
  const label = LIBRARY_TAB_LABELS[tab];
  const Icon = SOURCE_ICONS[tab];
  return (
    // Above the row's whole-row button, so its name shows on hover.
    <span
      role="img"
      aria-label={label}
      title={label}
      className="absolute bottom-1 right-1 z-10 grid size-4 place-items-center rounded-full bg-control text-fg-muted ring-2 ring-surface transition-colors duration-micro group-hover/row:bg-control-hover group-hover/row:ring-control group-focus-within/row:bg-control-hover group-focus-within/row:ring-control"
    >
      <Icon aria-hidden="true" className="size-2.5" strokeWidth={2.25} />
    </span>
  );
}

/** A title-bar button's "on" mark (a filter or search applies): a dot at its icon's top-right. */
function ActiveDot() {
  return (
    <span
      aria-hidden="true"
      className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-accent ring-2 ring-surface transition-colors duration-micro group-hover/dot:ring-control"
    />
  );
}

/**
 * The source filter: a funnel opening a menu of "All games" and each source with games (with its
 * count), the chosen one checked. The funnel carries a dot while a source is chosen.
 */
export function RecentGamesFilter({
  options,
  value,
  onChange
}: {
  options: readonly RecentGamesFilterOption[];
  value: LibraryTab | null;
  onChange: (tab: LibraryTab | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);
  const { present, state } = usePresence(open);
  const label = value ? `Filter: ${LIBRARY_TAB_LABELS[value]}` : "Filter games";

  return (
    <div ref={rootRef} className="relative inline-flex">
      <IconButton
        label={label}
        icon={
          <>
            <ListFilter />
            {value ? <ActiveDot /> : null}
          </>
        }
        className="group/dot relative"
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
            {options.map((option) => {
              const checked = option.tab === value;
              return (
                <button
                  key={option.tab ?? "all"}
                  type="button"
                  role="menuitemradio"
                  aria-checked={checked}
                  tabIndex={state === "closed" ? -1 : undefined}
                  onClick={() => {
                    setOpen(false);
                    onChange(option.tab);
                  }}
                  className="flex h-8 items-center gap-2 whitespace-nowrap rounded-md px-2 text-left text-sm text-fg-secondary outline-none transition-colors hover:bg-control hover:text-fg focus-visible:bg-control"
                >
                  <span className="grid size-4 shrink-0 place-items-center text-accent">
                    {checked ? <Check aria-hidden="true" className="size-4" /> : null}
                  </span>
                  <span className="flex-1">{option.label}</span>
                  <span className="pl-4 text-xs tabular-nums text-fg-subtle">{option.count}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Search, folded into a magnifier until opened: then a field (✕ or Esc clears it and folds it
 * back, focus returning to the magnifier). Leaving the field with text in it folds it too; the
 * search still applies, and the magnifier carries a dot.
 */
export function RecentGamesSearch({
  query,
  onQueryChange
}: {
  query: string;
  onQueryChange: (query: string) => void;
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
        label={active ? `Search: ${query.trim()}` : "Search games"}
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
        aria-label="Search games"
        placeholder="Search games"
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
