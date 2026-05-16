import { cn } from "@/lib/utils";
import type { MoveReview } from "@chaturanga/shared/types/engine";

export const panel =
  "w-full min-w-0 rounded-[10px] border border-white/10 bg-[#181a1d]/95 bg-gradient-to-b from-white/[0.05] to-transparent shadow-[0_12px_34px_rgb(0_0_0/0.20)]";

/** Scroll region inside workspace “Moves” / “Recent games” inner panel; pairs with `.game-panel-scroll` in app.css */
export const gamePanelScrollBody =
  "game-panel-scroll mt-3 min-h-0 flex-1 overflow-y-auto overflow-x-hidden scroll-py-3.5 rounded-lg border border-white/[0.07] bg-[#151719] p-2";

export const modalBackdrop =
  "fixed inset-0 z-50 grid place-items-center bg-black/60";

export const modalPanel =
  "max-h-[calc(100vh-48px)] w-[min(720px,calc(100vw-40px))] overflow-auto rounded-[10px] border border-white/10 bg-[#1a1d20] p-[18px] shadow-[0_24px_80px_rgb(0_0_0/0.42)]";

export const modalPanelCompact =
  "max-h-[calc(100vh-48px)] w-[min(460px,calc(100vw-40px))] overflow-auto rounded-[10px] border border-white/10 bg-[#1a1d20] p-[18px] shadow-[0_24px_80px_rgb(0_0_0/0.42)]";

export const input =
  "w-full rounded-[7px] border border-[#30343a] bg-[#141619] px-2.5 py-2 text-sm text-[#f4f1ea] outline-none transition-colors placeholder:text-[#727982] focus:border-[#8fb66f]/60";

export const textarea =
  "min-h-[260px] w-full resize-y rounded-[7px] border border-[#30343a] bg-[#141619] px-2.5 py-2 text-sm text-[#f4f1ea] outline-none transition-colors placeholder:text-[#727982] focus:border-[#8fb66f]/60 font-mono";

export const label = "grid gap-1.5 text-sm text-[#d8d8d8]";

export const muted = "text-[13px] text-[#a9adb4]";

export const empty = "text-[13px] text-[#a9adb4]";

export const error = "text-[13px] text-[#ff9a8d]";

export const sectionHeader = "flex min-h-[34px] items-center justify-between gap-2.5";

export const dialogActions = "mt-3.5 flex items-center justify-end gap-2.5";

export const tagBase =
  "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none";

const classificationColor: Record<MoveReview["classification"], string> = {
  best: "border-[#3e7966] bg-[#20503e] text-[#c8f0d8]",
  excellent: "border-[#3e7966] bg-[#20503e] text-[#c8f0d8]",
  good: "border-[#4f6278] bg-[#2d3a4a] text-[#cad9ec]",
  inaccuracy: "border-[#7a6730] bg-[#5a4a1a] text-[#ffe49a]",
  mistake: "border-[#76502d] bg-[#6b3b1e] text-[#ffd0aa]",
  blunder: "border-[#843f3a] bg-[#6e2a26] text-[#ffd1ca]",
  missed_tactic: "border-[#843f3a] bg-[#6e2a26] text-[#ffd1ca]"
};

const stripColor: Record<MoveReview["classification"], string> = {
  best: "bg-[#55bd89]",
  excellent: "bg-[#55bd89]",
  good: "bg-[#8aa0b5]",
  inaccuracy: "bg-[#e2c44f]",
  mistake: "bg-[#e89452]",
  blunder: "bg-[#df5c54]",
  missed_tactic: "bg-[#df5c54]"
};

export function classificationClass(classification: MoveReview["classification"]) {
  return classificationColor[classification];
}

export function stripClass(classification: MoveReview["classification"]) {
  return stripColor[classification];
}

export function tagClass(classification: MoveReview["classification"]) {
  return cn(tagBase, classificationColor[classification]);
}
