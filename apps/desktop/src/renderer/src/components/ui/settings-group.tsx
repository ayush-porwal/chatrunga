import type { ComponentProps, ReactNode } from "react";
import type { SettingRow } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/** The selects in a group's rows: as tall as the segmented controls beside them, as wide as their text. */
export const settingsRowSelect = "h-8 w-auto text-[0.8125rem] border-line-strong";

/** A titled group of setting rows in one bordered box (the settings dialogs: Analysis, Game review). */
export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="px-1 pb-1.5 text-2xs text-fg-subtle">{title}</h3>
      <div className="grid divide-y divide-line-subtle rounded-[10px] border border-line bg-surface">
        {children}
      </div>
    </section>
  );
}

/**
 * One setting in a group: its label (and hint) on the left, its control on the right, and
 * anything that belongs to it (a nested setting, a search's depth) underneath.
 */
export function SettingsGroupRow({
  label,
  description,
  control,
  htmlFor,
  className,
  children
}: ComponentProps<typeof SettingRow> & { children?: ReactNode }) {
  return (
    <div className={cn("grid gap-2 px-3 py-2", className)}>
      <div className="flex min-h-8 items-center gap-3">
        <div className="grid min-w-0 flex-1 gap-px">
          <label htmlFor={htmlFor} className="text-[0.84375rem] font-medium text-fg">
            {label}
          </label>
          {description ? <p className="text-xs text-fg-subtle">{description}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">{control}</div>
      </div>
      {children ? <div className="pb-1">{children}</div> : null}
    </div>
  );
}

/**
 * A setting that refines the one above it (the arrows to show, the bar's side, Maia's levels):
 * indented under it, and dimmed while that one is off. It keeps its place so the dialog never
 * jumps.
 */
export function NestedSettingRow({
  label,
  description,
  control,
  disabled
}: {
  label: string;
  description?: string;
  control: ReactNode;
  disabled: boolean;
}) {
  return (
    <div
      className={cn(
        "ml-1 grid gap-px border-l border-line pl-3 transition-opacity duration-micro",
        disabled && "opacity-60"
      )}
    >
      <div className="flex min-h-8 items-center gap-3">
        <span className="min-w-0 flex-1 text-[0.8125rem] text-fg-secondary">{label}</span>
        <div className="flex shrink-0 items-center gap-2">{control}</div>
      </div>
      {description ? <p className="text-xs text-fg-subtle">{description}</p> : null}
    </div>
  );
}
