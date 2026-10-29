import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { nextTabIndex, type WorkspaceTab } from "../features/board/WorkspaceTabBar";

/**
 * A page's tabs in the app titlebar, after its title (Repertoire: Repertoires · Practice ·
 * Insights): the workspace tab bar's look (an accent underline on the active tab, a count pill
 * beside a label that has one), then the tab's own actions at the row's right end (the settings
 * cog last). The page's content is the tab panel (`tabPanelProps(panelId, value)`). Arrow keys,
 * Home and End move between the tabs, selecting them (WAI-ARIA tabs). The tabs and actions are
 * out of the window's drag region.
 */
export function TitlebarTabs<T extends string>({
  panelId,
  ariaLabel,
  tabs,
  value,
  onChange,
  actions
}: {
  panelId: string;
  ariaLabel: string;
  tabs: readonly WorkspaceTab<T>[];
  value: T;
  onChange: (tab: T) => void;
  actions?: ReactNode;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const current = tabs.findIndex((item) => item.value === value);
    const next = nextTabIndex(event.key, current, tabs.length);
    const target = next === null ? undefined : tabs.at(next);
    if (!target) return;
    event.preventDefault();
    onChange(target.value);
    document.getElementById(`${panelId}-tab-${target.value}`)?.focus();
  };
  return (
    <>
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="flex h-full items-stretch gap-0.5 [-webkit-app-region:no-drag]"
      >
        {tabs.map((item) => {
          const selected = item.value === value;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              id={`${panelId}-tab-${item.value}`}
              aria-controls={panelId}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(item.value)}
              onKeyDown={onKeyDown}
              className={cn(
                "relative flex items-center gap-1.75 px-2.5 text-[0.84375rem] font-medium outline-none transition-colors duration-micro ease-standard focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-inset",
                selected ? "text-fg" : "text-fg-muted hover:text-fg"
              )}
            >
              {item.label}
              {item.count ? (
                // Decorative: the tab is named by its label alone.
                <span
                  aria-hidden="true"
                  className="inline-grid h-4.5 min-w-5 place-items-center rounded-full bg-control px-1.5 text-2xs font-semibold text-fg-muted tabular-nums"
                >
                  {item.count}
                </span>
              ) : null}
              {selected ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-2.5 bottom-1.5 h-0.5 rounded-full bg-accent"
                />
              ) : null}
            </button>
          );
        })}
      </div>
      {actions ? (
        <div className="ml-auto flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]">
          {actions}
        </div>
      ) : null}
    </>
  );
}
