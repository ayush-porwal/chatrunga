import { useEffect, useMemo, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import { cn } from "@/lib/utils";
import { useGameStore } from "../../stores/game-store";
import { mainlinePath } from "../game/move-tree-model";
import { blackToMove, fullMoveCount } from "./move-counter";

/** One title-bar tab: its label and an optional count pill (none for 0). */
export type WorkspaceTab<T extends string> = { value: T; label: string; count?: number | null };

/** The tab element's id for `tab` in the tab bar that controls `panelId` (as `tabPanelProps`). */
function tabId(panelId: string, tab: string): string {
  return `${panelId}-tab-${tab}`;
}

/**
 * The workspace panel's title bar: text tabs across the top of the panel (an accent underline on
 * the active one, a count pill beside a label that has one) and, at the right end, the tab's own
 * actions (the settings cog last). Arrow keys / Home / End move between the tabs, selecting them
 * (WAI-ARIA tabs). With `fitNarrow` (more tabs than fit a narrow panel), the tabs spread evenly over
 * the bar; narrow panels tighten them, then drop the pills; narrower still (or with larger text)
 * the tabs scroll sideways, the selected one kept in view.
 */
export function WorkspaceTabBar<T extends string>({
  panelId,
  ariaLabel,
  tabs,
  value,
  onChange,
  actions,
  fitNarrow = false
}: {
  panelId: string;
  ariaLabel: string;
  tabs: readonly WorkspaceTab<T>[];
  value: T;
  onChange: (tab: T) => void;
  actions?: ReactNode;
  fitNarrow?: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  // A tab chosen while scrolled out of view (a narrow panel) comes into it. Only the tab list
  // scrolls (scrollIntoView would also move the panel's clipping ancestors).
  useEffect(() => {
    if (!fitNarrow) return;
    const list = listRef.current;
    const tab = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (list && tab) list.scrollLeft = keptInView(list, tab);
  }, [fitNarrow, value]);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const current = tabs.findIndex((item) => item.value === value);
    const next = nextTabIndex(event.key, current, tabs.length);
    const target = next === null ? undefined : tabs.at(next);
    if (!target) return;
    event.preventDefault();
    onChange(target.value);
    document.getElementById(tabId(panelId, target.value))?.focus();
  };
  return (
    <div className="flex h-12 items-stretch gap-0.5 border-b border-line-subtle pr-2 pl-1.5">
      <div
        ref={listRef}
        role="tablist"
        aria-label={ariaLabel}
        className={cn("flex items-stretch gap-0.5", fitNarrow && FIT_NARROW.list)}
      >
        {tabs.map((item) => {
          const selected = item.value === value;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              id={tabId(panelId, item.value)}
              aria-controls={panelId}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(item.value)}
              onKeyDown={onKeyDown}
              className={cn(
                "relative flex items-center gap-1.75 px-2.5 text-[0.84375rem] font-medium outline-none transition-colors duration-micro ease-standard focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-inset",
                fitNarrow && FIT_NARROW.tab,
                selected ? "text-fg" : "text-fg-muted hover:text-fg"
              )}
            >
              {item.label}
              {item.count ? (
                // Decorative: the tab is named by its label alone.
                <span
                  aria-hidden="true"
                  className={cn(
                    "inline-grid h-4.5 min-w-5 place-items-center rounded-full bg-control px-1.5 text-2xs font-semibold text-fg-muted tabular-nums",
                    fitNarrow && FIT_NARROW.pill
                  )}
                >
                  {item.count}
                </span>
              ) : null}
              {selected ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute inset-x-2.5 -bottom-px h-0.5 rounded-full bg-accent",
                    fitNarrow && FIT_NARROW.underline
                  )}
                />
              ) : null}
            </button>
          );
        })}
      </div>
      {actions ? <div className="ml-auto flex shrink-0 items-center gap-0.5">{actions}</div> : null}
    </div>
  );
}

/**
 * `fitNarrow`'s classes (Game review's four tabs). The list scrolls sideways, which clips what leaves its box, so it reaches
 * down over the bar's bottom border (`-mb-px`) and the underline sits at its foot, on that border
 * as before.
 */
const FIT_NARROW = {
  // The tabs spread evenly over the room before the actions: each takes an equal share of what is
  // left beyond its label (never less than the label, so a narrow panel still scrolls).
  list: "relative -mb-px min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]",
  tab: "shrink-0 grow justify-center whitespace-nowrap @max-[440px]/panel:px-1.5 @max-[380px]/panel:text-xs @max-[360px]/panel:px-1",
  pill: "@max-[360px]/panel:hidden",
  underline: "bottom-0 @max-[440px]/panel:inset-x-1.5 @max-[360px]/panel:inset-x-1"
};

/** The list's scroll offset that shows all of `tab` (unchanged when it already shows). */
function keptInView(list: HTMLElement, tab: HTMLElement): number {
  // The list is positioned (FIT_NARROW): the tab's offset is within it.
  const start = tab.offsetLeft;
  const end = start + tab.offsetWidth;
  if (start < list.scrollLeft) return start;
  if (end > list.scrollLeft + list.clientWidth) return end - list.clientWidth;
  return list.scrollLeft;
}

/** The tab a navigation key moves to from `current` (wrapping), or null for any other key. */
function nextTabIndex(key: string, current: number, count: number): number | null {
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/** The game's length in full moves along its main line (a Moves tab's count). */
export function useMainlineMoveCount(): number {
  const moveTree = useGameStore((state) => state.moveTree);
  return useMemo(() => mainlineMoveCount(moveTree), [moveTree]);
}

function mainlineMoveCount(moveTree: readonly MoveNode[]): number {
  // The path starts at the root (none in an empty tree): its moves are the rest.
  const path = mainlinePath(moveTree);
  return fullMoveCount(path.slice(1).length, blackToMove(path.at(0)?.fenBefore));
}
