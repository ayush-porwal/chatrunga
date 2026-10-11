import { localImageSrc } from "@/lib/local-image";
import { cn } from "@/lib/utils";
import { PieceArt, useBoardSquareColors } from "../play/piece-art";

/**
 * The engine image slot's sizes: the Moves tab's engine row (40px), player rows and pickers (24px),
 * inline (18px), or filling a tile of its own size and rounding (Play's opponent tile).
 */
const SIZES = {
  lg: "size-10 rounded-[10px]",
  sm: "size-6 rounded-[7px]",
  xs: "size-4.5 rounded-[5px]",
  fill: "size-full rounded-[inherit]"
} as const;

/**
 * An engine's picture in a rounded square: its own image filling the square when it has one;
 * until then a knight (the user's piece set) on the board's dark square. One slot wherever an
 * engine is shown (Engine tab, player rows, engine pickers, Play), so engine images drop in later.
 */
export function EngineAvatar({
  imagePath,
  size = "sm",
  className
}: {
  imagePath?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const src = localImageSrc(imagePath);
  const { dark } = useBoardSquareColors();
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-block shrink-0 overflow-hidden shadow-[inset_0_0_0_1px_rgb(0_0_0/0.25),0_4px_10px_-6px_rgb(0_0_0/0.7)]",
        SIZES[size],
        className
      )}
      style={{ backgroundColor: dark }}
    >
      {src ? (
        <img className="size-full object-cover" src={src} alt="" />
      ) : (
        <PieceArt
          color="white"
          piece="knight"
          // Inline: the unlayered `.cg-wrap` rule (position: relative) beats position utilities.
          style={{ position: "absolute", inset: "9%" }}
        />
      )}
    </span>
  );
}
