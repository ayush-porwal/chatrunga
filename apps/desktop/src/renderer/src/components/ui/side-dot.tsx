import { cn } from "@/lib/utils";

/**
 * Round chess-side swatch (side to move, "Play as", player badges).
 *
 *   <SideDot color="white" />  <SideDot color="black" size="md" />
 */
function SideDot({
  color,
  size = "sm",
  className
}: {
  color: "white" | "black";
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block shrink-0 rounded-full",
        size === "sm" ? "size-2.5" : "size-4",
        color === "white"
          ? "bg-piece-white shadow-[0_0_0_1px_rgb(0_0_0/0.4)]"
          : "bg-piece-black shadow-[0_0_0_1px_rgb(255_255_255/0.22)]",
        className
      )}
    />
  );
}

export { SideDot };
