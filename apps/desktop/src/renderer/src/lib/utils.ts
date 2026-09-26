import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge about the custom theme scales in styles/app.css so e.g.
// `text-2xs` is treated as a font size and `shadow-overlay` as a shadow.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["2xs"],
      shadow: ["overlay", "popover"]
    }
  }
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
