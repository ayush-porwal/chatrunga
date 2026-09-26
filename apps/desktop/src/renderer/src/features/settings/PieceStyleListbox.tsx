import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  pieceStyleOptions,
  type PiecePresentation,
  type PieceStyle
} from "@chaturanga/shared/types/settings";
import { cn } from "@/lib/utils";
import { useDismiss } from "@/lib/use-dismiss";
import { fieldLabel } from "@/lib/ui";
import {
  settingsListboxOptionActiveClass,
  settingsListboxOptionClass,
  settingsListboxPopoverClass,
  settingsListboxTriggerClass,
  settingsListboxTriggerOpenRing
} from "@/lib/settings-listbox";
import { PieceStylePreviewStrip } from "./piece-style-preview";

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
  const [highlightedIndex, setHighlightedIndex] = useState(() =>
    Math.max(
      0,
      pieceStyleOptions.findIndex((o) => o.id === value)
    )
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selectedMeta = pieceStyleOptions.find((o) => o.id === value) ?? pieceStyleOptions[0];

  // Opening the list (or a new value) highlights the selected option.
  useEffect(() => {
    const idx = pieceStyleOptions.findIndex((o) => o.id === value);
    setHighlightedIndex(idx >= 0 ? idx : 0);
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(`${id}-opt-${highlightedIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [open, highlightedIndex, id]);

  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);

  const commitIndex = useCallback(
    (index: number) => {
      const opt = pieceStyleOptions[index];
      if (opt) onChange(opt.id);
      setOpen(false);
      triggerRef.current?.focus();
    },
    [onChange]
  );

  function moveHighlight(delta: number) {
    setHighlightedIndex((prev) => {
      const len = pieceStyleOptions.length;
      if (!len) return 0;
      let next = (prev + delta) % len;
      if (next < 0) next += len;
      return next;
    });
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (
        event.key === "ArrowDown" ||
        event.key === "ArrowUp" ||
        event.key === "Enter" ||
        event.key === " "
      ) {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveHighlight(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveHighlight(-1);
        break;
      case "Home":
        event.preventDefault();
        setHighlightedIndex(0);
        break;
      case "End":
        event.preventDefault();
        setHighlightedIndex(pieceStyleOptions.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        commitIndex(highlightedIndex);
        break;
      case "Escape":
        event.preventDefault();
        setOpen(false);
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        break;
    }
  }

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
          aria-haspopup="listbox"
          aria-controls={listboxDomId}
          aria-labelledby={`${id}-label`}
          aria-activedescendant={open ? `${id}-opt-${highlightedIndex}` : undefined}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={onTriggerKeyDown}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2.5">
            <PieceStylePreviewStrip pieceStyle={value} piecePresentation={piecePresentation} density="default" />
            <span className="min-w-0 truncate text-left text-sm font-medium">{selectedMeta.label}</span>
          </span>
          <ChevronDown
            className={cn("size-4 shrink-0 text-fg-subtle transition-transform", open && "rotate-180")}
            aria-hidden
          />
        </button>
        {open ? (
          <div
            id={listboxDomId}
            role="listbox"
            aria-labelledby={`${id}-label`}
            className={cn(settingsListboxPopoverClass, "right-0")}
          >
            {pieceStyleOptions.map((opt, index) => {
              const active = opt.id === value;
              const highlighted = index === highlightedIndex;
              return (
                <button
                  key={opt.id}
                  id={`${id}-opt-${index}`}
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
                  onClick={() => commitIndex(index)}
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
        ) : null}
      </div>
    </div>
  );
}
