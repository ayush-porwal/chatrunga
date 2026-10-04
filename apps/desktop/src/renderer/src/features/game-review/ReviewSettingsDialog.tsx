import { useEffect } from "react";
import { SlidersHorizontal } from "lucide-react";
import { create } from "zustand";
import type { AppSettings } from "@chaturanga/shared/types/settings";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import { ReviewSettingsPanel, type ReviewSideSetting } from "./ReviewSettingsPanel";

/**
 * Whether the review settings dialog is open. A store, so App can open it too (Analyze without a
 * usable engine sends the user there).
 */
export const useReviewSettingsDialog = create<{ open: boolean; setOpen: (open: boolean) => void }>(
  (set) => ({ open: false, setOpen: (open) => set({ open }) })
);

/** Opens the review settings dialog (from outside the review page). */
export function openReviewSettingsDialog(): void {
  useReviewSettingsDialog.getState().setOpen(true);
}

const SLIDERS_ICON = <SlidersHorizontal />;

/**
 * The review's settings behind a sliders button in the side panel's header (as the Analyze page
 * keeps its engine settings): the engine, Maia, AI commentary, the side the game is reviewed as,
 * and links to Settings → AI and the ratings.
 */
export function ReviewSettingsButton({
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
  return (
    <>
      <IconButton
        label="Review settings"
        icon={SLIDERS_ICON}
        onClick={() => setOpen(true)}
        className="shrink-0"
      />
      {open ? (
        <Dialog
          title="Review settings"
          description="The engine and models a review runs, the side it's for, and its AI commentary."
          onClose={close}
          footer={
            <Button type="button" variant="primary" size="sm" onClick={close}>
              Done
            </Button>
          }
        >
          <ReviewSettingsPanel
            embedded
            settings={settings}
            onClose={close}
            reviewSide={reviewSide}
          />
        </Dialog>
      ) : null}
    </>
  );
}
