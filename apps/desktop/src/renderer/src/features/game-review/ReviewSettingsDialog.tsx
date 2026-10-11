import { useEffect } from "react";
import { create } from "zustand";
import type { AppSettings } from "@chaturanga/shared/types/settings";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { BoardSettingsGroup } from "../board/BoardSettingsGroup";
import { ReviewSettingsPanel, type ReviewSideSetting } from "./ReviewSettingsPanel";

/**
 * Whether the review settings dialog is open. A store, so App can open it too (Analyze without a
 * usable engine sends the user there).
 */
const useReviewSettingsDialog = create<{ open: boolean; setOpen: (open: boolean) => void }>(
  (set) => ({ open: false, setOpen: (open) => set({ open }) })
);

/** Opens the review settings dialog (from outside the review page). */
export function openReviewSettingsDialog(): void {
  useReviewSettingsDialog.getState().setOpen(true);
}

/**
 * The review's settings as a dialog, open while the store says so: the engine and Maia, the board
 * (the engine arrows and evaluation bar, shared with Analysis settings), AI commentary, the side
 * the game is reviewed as (with its rating), and links to Settings → AI and the ratings. Rendered
 * by the review page; closed when it goes.
 */
export function ReviewSettingsDialog({
  settings,
  reviewSide
}: {
  settings: AppSettings;
  reviewSide?: ReviewSideSetting;
}) {
  const open = useReviewSettingsDialog((state) => state.open);
  const setOpen = useReviewSettingsDialog((state) => state.setOpen);
  const close = () => setOpen(false);
  // Leaving the review closes it (it doesn't reopen on the next visit).
  useEffect(() => () => useReviewSettingsDialog.getState().setOpen(false), []);
  if (!open) return null;
  return (
    <Dialog
      title="Review settings"
      size="sm"
      onClose={close}
      footer={
        <div className="-mx-5 -mb-5 flex flex-1 items-center justify-end gap-2 border-t border-line-subtle px-4 py-3">
          <Button type="button" variant="primary" size="sm" onClick={close}>
            Done
          </Button>
        </div>
      }
    >
      <ReviewSettingsPanel
        settings={settings}
        reviewSide={reviewSide}
        board={<BoardSettingsGroup settings={settings} />}
      />
    </Dialog>
  );
}
