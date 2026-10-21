import { useState } from "react";
import {
  enginePicture,
  fallbackPicture,
  type EngineIdentity,
  type EnginePicture
} from "@/lib/engine-identity";
import { cn } from "@/lib/utils";

/**
 * The engine image slot's sizes: the Moves tab's engine row (40px), Settings → Engines' rows and
 * image field (36px), player rows and pickers (24px), inline (18px), or filling a tile of its own
 * size and rounding (Play's opponent tile).
 */
const SIZES = {
  lg: "size-10 rounded-[10px]",
  md: "size-9 rounded-[9px]",
  sm: "size-6 rounded-[7px]",
  xs: "size-4.5 rounded-[5px]",
  fill: "size-full rounded-[inherit]"
} as const;

/**
 * An engine's picture in a rounded square: its own image, else its family's logo (Stockfish,
 * Maia, Lc0), else its initials on a tile tinted from its name; an empty tile for no engine (none
 * installed). One slot wherever an engine is shown (Engine tab, player rows, pickers, Play,
 * Settings). Decorative beside the engine's name; `label` gives it a name of its own.
 */
export function EngineAvatar({
  engine,
  size = "sm",
  label,
  className
}: {
  engine: EngineIdentity | null | undefined;
  size?: keyof typeof SIZES;
  /** Screen-reader text, where the slot needs a name of its own. */
  label?: string;
  className?: string;
}) {
  // An image that failed to load (moved, deleted, on an unmounted drive, half-typed in the
  // editor) gives way to the logo or monogram; a different path tries again.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const resolved = engine ? enginePicture(engine) : null;
  const picture =
    engine && resolved?.kind === "image" && resolved.src === failedSrc
      ? fallbackPicture(engine)
      : resolved;
  return (
    <span
      aria-hidden={label ? undefined : "true"}
      className={cn(
        "@container relative inline-grid shrink-0 place-items-center overflow-hidden bg-control shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08),0_4px_10px_-6px_rgb(0_0_0/0.7)]",
        SIZES[size],
        className
      )}
      style={
        picture?.kind === "monogram"
          ? { backgroundColor: `oklch(0.42 0.07 ${picture.hue})` }
          : undefined
      }
    >
      {picture ? (
        <PictureContent picture={picture} oneLetter={size === "xs"} onError={setFailedSrc} />
      ) : null}
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}

/** The slot's image, or its monogram, which scales with the slot (container units). */
function PictureContent({
  picture,
  oneLetter,
  onError
}: {
  picture: EnginePicture;
  oneLetter: boolean;
  /** The engine's own image failed to load: called with its src. */
  onError: (src: string) => void;
}) {
  if (picture.kind === "monogram") {
    const text = oneLetter ? picture.text.slice(0, 1) : picture.text;
    return text ? (
      <span
        className={cn(
          "select-none font-semibold leading-none tracking-tight text-fg",
          text.length > 1 ? "text-[40cqi]" : "text-[50cqi]"
        )}
      >
        {text}
      </span>
    ) : null;
  }
  return (
    <img
      className={cn(
        "size-full",
        // Maia's mark is transparent: inset on the neutral tile; the other pictures fill it.
        picture.kind === "logo" && picture.family === "maia"
          ? "object-contain p-[14%]"
          : "object-cover"
      )}
      src={picture.src}
      onError={picture.kind === "image" ? () => onError(picture.src) : undefined}
      alt=""
      decoding="async"
      draggable={false}
    />
  );
}
