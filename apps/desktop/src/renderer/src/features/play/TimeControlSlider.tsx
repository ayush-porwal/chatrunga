import { useId, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CUSTOM_INCREMENT,
  CUSTOM_MINUTES,
  nearestStop,
  stepIncrement,
  stepMinutes,
  stopAtPointer,
  stopForKey,
  stopPercent
} from "./time-control";

export type SliderStop = {
  key: string;
  /** What sits under the stop: "5+3", or an icon. */
  label: ReactNode;
  /** The stop in words, for the tooltip and the slider's value ("Blitz · 5 min + 3 s"). */
  text: string;
};

/**
 * Play's time control: a labelled track with one stop per preset and a thumb. Dragging moves the
 * thumb freely and snaps to the nearest stop on release; a press on a stop or its label picks it;
 * the arrow keys (and Home/End) step through the stops.
 */
export function TimeControlSlider({
  stops,
  value,
  onChange,
  children
}: {
  stops: readonly SliderStop[];
  /** The selected stop's index. */
  value: number;
  onChange: (index: number) => void;
  /** Under the slider (Custom's steppers). */
  children?: ReactNode;
}) {
  const labelId = useId();
  const trackRef = useRef<HTMLDivElement | null>(null);
  // The thumb's fractional place while it is dragged; null at rest (it sits on `value`).
  const [drag, setDrag] = useState<number | null>(null);
  const count = stops.length;
  const index = Math.min(Math.max(0, value), Math.max(0, count - 1));
  const position = drag ?? index;
  const near = nearestStop(position, count);
  const percent = stopPercent(position, count);

  function at(event: PointerEvent<HTMLDivElement>): number {
    const rect = trackRef.current?.getBoundingClientRect();
    return rect ? stopAtPointer(event.clientX, rect.left, rect.width, count) : index;
  }

  function release(event: PointerEvent<HTMLDivElement>) {
    if (drag === null) return;
    const stop = nearestStop(at(event), count);
    setDrag(null);
    if (stop !== index) onChange(stop);
  }

  return (
    <div className="grid gap-2">
      <span id={labelId} className="text-xs font-medium text-fg-muted">
        Time control
      </span>
      <div
        role="slider"
        tabIndex={0}
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, count - 1)}
        aria-valuenow={index}
        aria-valuetext={stops[index]?.text}
        data-dragging={drag === null ? undefined : ""}
        className="play-slider"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDrag(at(event));
        }}
        onPointerMove={(event) => {
          if (drag !== null) setDrag(at(event));
        }}
        onPointerUp={release}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={(event) => {
          const next = stopForKey(event.key, index, count);
          if (next === null) return;
          event.preventDefault();
          if (next !== index) onChange(next);
        }}
      >
        <div ref={trackRef} className="play-slider-track">
          <div className="play-slider-fill" style={{ width: `${percent}%` }} />
          {stops.map((stop, stopIndex) => (
            <i
              key={stop.key}
              className="play-slider-tick"
              data-in={stopIndex <= position + 0.001 ? "" : undefined}
              style={{ left: `${stopPercent(stopIndex, count)}%` }}
            />
          ))}
          <div className="play-slider-thumb" style={{ left: `${percent}%` }} />
        </div>
        <div className="play-slider-labels" aria-hidden="true">
          {stops.map((stop, stopIndex) => (
            <span
              key={stop.key}
              className="play-slider-label"
              data-on={stopIndex === near ? "" : undefined}
              style={{ left: `${stopPercent(stopIndex, count)}%` }}
              title={stop.text}
            >
              {stop.label}
            </span>
          ))}
        </div>
      </div>
      {children}
    </div>
  );
}

/** Custom time: minutes per side and seconds added per move, as two steppers in one row. */
export function CustomClockSteppers({
  minutes,
  incrementSec,
  onMinutes,
  onIncrement
}: {
  minutes: number;
  incrementSec: number;
  onMinutes: (value: number) => void;
  onIncrement: (value: number) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Stepper
        label="Minutes per side"
        value={minutes}
        unit="min"
        canLess={minutes > CUSTOM_MINUTES.min}
        canMore={minutes < CUSTOM_MINUTES.max}
        onStep={(direction) => onMinutes(stepMinutes(minutes, direction))}
      />
      <Stepper
        label="Increment"
        value={incrementSec}
        unit="s"
        canLess={incrementSec > CUSTOM_INCREMENT.min}
        canMore={incrementSec < CUSTOM_INCREMENT.max}
        onStep={(direction) => onIncrement(stepIncrement(incrementSec, direction))}
      />
    </div>
  );
}

function Stepper({
  label,
  value,
  unit,
  canLess,
  canMore,
  onStep
}: {
  label: string;
  value: number;
  unit: string;
  canLess: boolean;
  canMore: boolean;
  onStep: (direction: 1 | -1) => void;
}) {
  const step =
    "grid size-7.5 place-items-center rounded-lg text-fg-muted outline-none transition-colors duration-micro hover:bg-control hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/70 disabled:pointer-events-none disabled:opacity-25 [&>svg]:size-3.75";
  return (
    <div
      role="group"
      aria-label={label}
      className="grid grid-cols-[1.875rem_1fr_1.875rem] items-center rounded-xl border border-line bg-surface-sunken px-2.5 pb-2 pt-2.5"
    >
      <button
        type="button"
        aria-label={`Less (${label.toLowerCase()})`}
        disabled={!canLess}
        className={step}
        onClick={() => onStep(-1)}
      >
        <Minus />
      </button>
      <span className="inline-flex items-baseline justify-center gap-0.75 tabular-nums">
        <b
          className="text-[1.375rem] font-semibold leading-[1.1] tracking-[-0.02em] text-fg"
          aria-live="polite"
        >
          {value}
        </b>
        <small className="text-xs text-fg-subtle">{unit}</small>
      </span>
      <button
        type="button"
        aria-label={`More (${label.toLowerCase()})`}
        disabled={!canMore}
        className={cn(step, "justify-self-end")}
        onClick={() => onStep(1)}
      >
        <Plus />
      </button>
    </div>
  );
}
