import { useCallback, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { engineDisplayName } from "@chaturanga/shared/engine/managed";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import type { EngineIdentity } from "@/lib/engine-identity";
import { settingsListboxPositionClass, settingsListboxSurfaceClass } from "@/lib/settings-listbox";
import { frost } from "@/lib/ui";
import { useDismiss } from "@/lib/use-dismiss";
import { useListboxKeyboard } from "@/lib/use-listbox-keyboard";
import { cn } from "@/lib/utils";
import { EngineAvatar } from "./EngineAvatar";

/** One choice in an {@link EnginePicker}. */
export type EnginePickerOption = {
  /** What `onChange` reports: the engine's id. */
  value: string;
  /** Whose picture the option shows (null: an empty tile). */
  engine: EngineIdentity | null;
  label: string;
  /** Listed but can't be chosen (an engine that can't run now). */
  disabled?: boolean;
};

/** An installed engine as a choice: its id, picture and name; listed but not choosable when it can't run. */
export function engineOption(engine: EngineConfig): EnginePickerOption {
  return {
    value: engine.id,
    engine,
    label: engineDisplayName(engine.name),
    disabled: !engine.isAvailable
  };
}

/**
 * The trigger's sizes: `md` fills a row of its own beside the engine's picture (Play settings'
 * engine row), so it shows none; `sm` sits beside a setting's label in a settings group (as tall
 * as the segmented controls there) and leads with the picture.
 */
const TRIGGER_SIZES = {
  md: "h-10 rounded-[9px] pl-3 pr-2.5 text-[0.84375rem]",
  sm: "h-8 max-w-60 rounded-lg pl-1 pr-2 text-[0.8125rem]"
} as const;

/**
 * An engine dropdown whose trigger and options show each engine's picture and name (a native
 * select can't show pictures): a select-only combobox (↓/↑/Enter/Space open it; ↓/↑, Home/End,
 * Enter/Space, Escape/Tab inside; disabled options are skipped) with its list under the trigger.
 * A `value` matching no option shows the first.
 */
export function EnginePicker({
  id,
  ariaLabel,
  options,
  value,
  onChange,
  onOpen,
  size = "sm",
  className
}: {
  /** The trigger's id (for a `<label htmlFor>` naming it). */
  id?: string;
  /** The trigger's name when no label names it. */
  ariaLabel?: string;
  options: readonly EnginePickerOption[];
  value: string | null;
  onChange: (value: string) => void;
  /** The trigger was pressed, or the list opened from the keyboard. */
  onOpen?: () => void;
  size?: keyof typeof TRIGGER_SIZES;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  );
  const { triggerRef, highlightedIndex, setHighlightedIndex, optionId, commit, onTriggerKeyDown } =
    useListboxKeyboard({
      id: listId,
      count: options.length,
      selectedIndex,
      isDisabled: (index) => Boolean(options[index]?.disabled),
      open,
      setOpen: (next) => {
        if (next) onOpen?.();
        setOpen(next);
      },
      onCommit: (index) => {
        const option = options.at(index);
        if (option) onChange(option.value);
      }
    });
  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);

  const selected = options.at(selectedIndex);
  return (
    <div ref={rootRef} className={cn("relative min-w-0", className)}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? `${listId}-listbox` : undefined}
        aria-activedescendant={open ? optionId(highlightedIndex) : undefined}
        disabled={!selected}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 border border-line-strong bg-surface-sunken text-left outline-none transition-colors duration-micro hover:border-accent focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line-strong",
          TRIGGER_SIZES[size],
          open && "border-accent"
        )}
        onClick={() => {
          onOpen?.();
          setOpen((current) => !current);
        }}
        onKeyDown={onTriggerKeyDown}
      >
        {size === "sm" ? <EngineAvatar engine={selected?.engine} size="sm" /> : null}
        <OptionText option={selected} />
        <ChevronDown
          className={cn(
            "size-3.75 shrink-0 text-fg-muted transition-transform duration-standard",
            open && "rotate-180"
          )}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div
          className={cn(
            settingsListboxPositionClass,
            "left-auto right-0 top-[calc(100%+4px)] w-max min-w-full max-w-72"
          )}
        >
          {/* The frosted layer under the list (glass), as in the piece-set listbox. */}
          <span aria-hidden="true" className={cn(frost, "rounded-lg")} />
          <div
            id={`${listId}-listbox`}
            role="listbox"
            aria-label="Engines"
            className={settingsListboxSurfaceClass}
          >
            {options.map((option, index) => {
              const active = index === selectedIndex;
              return (
                <button
                  key={option.value}
                  id={optionId(index)}
                  type="button"
                  role="option"
                  aria-selected={active}
                  aria-disabled={option.disabled || undefined}
                  tabIndex={-1}
                  disabled={option.disabled}
                  className={cn(
                    "flex items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-left text-[0.84375rem] outline-none transition-colors duration-micro hover:bg-control disabled:cursor-not-allowed disabled:opacity-50",
                    index === highlightedIndex && "bg-control"
                  )}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => commit(index)}
                >
                  <EngineAvatar engine={option.engine} size="sm" />
                  <OptionText option={option} />
                  {active ? (
                    <Check className="size-4 shrink-0 text-accent" aria-hidden="true" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** An option's name, truncated; with no options, that none is installed. */
function OptionText({ option }: { option: EnginePickerOption | undefined }) {
  return (
    <span className="min-w-0 flex-1 truncate">
      <b className="font-medium text-fg">{option?.label ?? "No engine installed"}</b>
    </span>
  );
}
