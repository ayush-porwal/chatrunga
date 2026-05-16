import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  pieceStyleOptions,
  type PiecePresentation,
  type PieceStyle
} from "@chaturanga/shared/types/settings";
import { cn } from "@/lib/utils";
import { gamePanelScrollBody, label } from "@/lib/ui";
import {
  settingsListboxOptionActiveClass,
  settingsListboxOptionClass,
  settingsListboxTriggerClass,
  settingsListboxTriggerOpenRing
} from "@/lib/settings-listbox";
import { PieceStylePreviewStrip } from "./piece-style-preview";

type PieceStyleListboxProps = {
  id: string;
  value: PieceStyle;
  piecePresentation: PiecePresentation;
  onChange: (next: PieceStyle) => void;
  describedBy?: string;
};

export function PieceStyleListbox({
  id,
  value,
  piecePresentation,
  onChange,
  describedBy
}: PieceStyleListboxProps) {
  const listboxDomId = `${id}-listbox`;
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(() =>
    Math.max(
      0,
      pieceStyleOptions.findIndex((o) => o.id === value)
    )
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null); // scroll container ref (optional future use)

  const selectedMeta = pieceStyleOptions.find((o) => o.id === value) ?? pieceStyleOptions[0];

  useEffect(() => {
    const idx = pieceStyleOptions.findIndex((o) => o.id === value);
    setHighlightedIndex(idx >= 0 ? idx : 0);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const selectedIdx = pieceStyleOptions.findIndex((o) => o.id === value);
    setHighlightedIndex(selectedIdx >= 0 ? selectedIdx : 0);
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(`${id}-opt-${highlightedIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [open, highlightedIndex, id]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const t = event.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (listRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

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
    <div className={cn(label, "min-w-0 max-w-full")}>
      <label id={`${id}-label`} htmlFor={id}>
        Piece set
      </label>
      <div className="relative w-full min-w-0">
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
          aria-describedby={describedBy}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={onTriggerKeyDown}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2.5">
            <PieceStylePreviewStrip pieceStyle={value} piecePresentation={piecePresentation} density="default" />
            <span className="grid min-w-0 gap-0.5 text-left">
              <strong className="truncate text-sm">{selectedMeta.label}</strong>
              <span className="truncate text-[11px] text-[#727982]">Chess piece theme</span>
            </span>
          </span>
          <ChevronDown
            size={16}
            className={cn("shrink-0 text-[#a9adb4] transition-transform", open && "rotate-180")}
            aria-hidden
          />
        </button>
        {open ? (
          <div
            ref={listRef}
            id={listboxDomId}
            role="listbox"
            aria-labelledby={`${id}-label`}
            className={cn(
              gamePanelScrollBody,
              "absolute left-0 right-0 top-[calc(100%+10px)] z-50 mt-0 flex-none grid max-h-72 min-h-0 gap-1 shadow-[0_18px_48px_rgb(0_0_0/0.42)]"
            )}
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
                    highlighted && !active && "bg-white/[0.04]"
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
                  {active ? <Check size={15} className="shrink-0 text-[#d7e8c5]" aria-hidden /> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
