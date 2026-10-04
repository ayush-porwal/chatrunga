import { useCallback, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  pieceStyleOptions,
  type PiecePresentation,
  type PieceStyle
} from "@chaturanga/shared/types/settings";
import { cn } from "@/lib/utils";
import { useDismiss } from "@/lib/use-dismiss";
import { fieldLabel, frost } from "@/lib/ui";
import { usePresence } from "@/components/ui/use-presence";
import {
  settingsListboxOptionActiveClass,
  settingsListboxOptionClass,
  settingsListboxPositionClass,
  settingsListboxSurfaceClass,
  settingsListboxTriggerClass,
  settingsListboxTriggerOpenRing
} from "@/lib/settings-listbox";
import { PieceStylePreviewStrip } from "./piece-style-preview";
import { useListboxKeyboard } from "@/lib/use-listbox-keyboard";

type PieceStyleListboxProps = {
  id: string;
  value: PieceStyle;
  piecePresentation: PiecePresentation;
  onChange: (next: PieceStyle) => void;
};

export function PieceStyleListbox({
  id,
  value,
  piecePresentation,
  onChange
}: PieceStyleListboxProps) {
  const listboxDomId = `${id}-listbox`;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selectedMeta = pieceStyleOptions.find((o) => o.id === value) ?? pieceStyleOptions[0];

  const close = useCallback(() => setOpen(false), []);
  const { present, state } = usePresence(open);
  useDismiss(rootRef, open, close);

  const { triggerRef, highlightedIndex, setHighlightedIndex, optionId, commit, onTriggerKeyDown } = useListboxKeyboard({
    id,
    count: pieceStyleOptions.length,
    selectedIndex: pieceStyleOptions.findIndex((o) => o.id === value),
    open,
    setOpen,
    onCommit: (index) => {
      const opt = pieceStyleOptions[index];
      if (opt) onChange(opt.id);
    }
  });

  return (
    <div className="grid min-w-0 max-w-full gap-1.5">
      <label id={`${id}-label`} htmlFor={id} className={fieldLabel}>
        Piece set
      </label>
      <div ref={rootRef} className="relative w-full min-w-0">
        <button
          ref={triggerRef}
          id={id}
          type="button"
          className={cn(settingsListboxTriggerClass, open && settingsListboxTriggerOpenRing)}
          aria-expanded={open}
          role="combobox"
          aria-haspopup="listbox"
          aria-controls={listboxDomId}
          aria-labelledby={`${id}-label`}
          aria-activedescendant={open ? optionId(highlightedIndex) : undefined}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={onTriggerKeyDown}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2.5">
            <PieceStylePreviewStrip pieceStyle={value} piecePresentation={piecePresentation} density="default" />
            <span className="min-w-0 truncate text-left text-sm font-medium">{selectedMeta.label}</span>
          </span>
          <ChevronDown
            className={cn("size-4 shrink-0 text-fg-subtle transition-transform duration-standard ease-standard", open && "rotate-180")}
            aria-hidden
          />
        </button>
        {present ? (
          <div className={cn(settingsListboxPositionClass, "right-0", state === "closed" && "pointer-events-none")}>
          {/* Stable frosted layer under the animated list (glass only). */}
          <span aria-hidden="true" data-state={state} className={cn(frost, "rounded-lg animate-fade-in data-[state=closed]:animate-fade-out")} />
          <div
            id={listboxDomId}
            role="listbox"
            aria-labelledby={`${id}-label`}
            data-state={state}
            className={settingsListboxSurfaceClass}
          >
            {pieceStyleOptions.map((opt, index) => {
              const active = opt.id === value;
              const highlighted = index === highlightedIndex;
              return (
                <button
                  key={opt.id}
                  id={optionId(index)}
                  type="button"
                  role="option"
                  aria-selected={active}
                  tabIndex={-1}
                  className={cn(
                    settingsListboxOptionClass,
                    active && settingsListboxOptionActiveClass,
                    highlighted && !active && "bg-control"
                  )}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => commit(index)}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2.5">
                    <PieceStylePreviewStrip
                      pieceStyle={opt.id}
                      piecePresentation={piecePresentation}
                      density="compact"
                    />
                    <strong className="min-w-0 truncate font-medium">{opt.label}</strong>
                  </span>
                  {active ? <Check className="size-4 shrink-0 text-accent-fg" aria-hidden /> : null}
                </button>
              );
            })}
          </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
