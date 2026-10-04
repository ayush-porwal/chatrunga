import { Settings } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { IconButton } from "@/components/ui/icon-button";
import { CollapsibleHeader, type Collapsible } from "@/components/ui/collapsible-section";
import { useReviewAnalysisStore } from "./review-live-analysis";
import { openReviewSettingsDialog } from "./ReviewSettingsDialog";

const SETTINGS_ICON = <Settings />;

/**
 * The review panel's heading row, the twin of the charts' "Winning chances" header: "⌄ Review"
 * folds the tabs and their content away (the charts take the space), and at the right the
 * Analysis switch (live engine analysis of the board, see review-live-analysis.ts) and the
 * review settings gear, always last.
 */
export function ReviewPanelHeader({
  section,
  analysisDisabled
}: {
  section: Collapsible;
  /** A review is running (the engine is busy with it), or there's no engine. */
  analysisDisabled: boolean;
}) {
  const on = useReviewAnalysisStore((state) => state.on);
  const setOn = useReviewAnalysisStore((state) => state.setOn);
  return (
    <CollapsibleHeader
      open={section.open}
      onToggle={section.toggle}
      controls={section.contentId}
      actions={
        <>
          <label className="flex items-center gap-1.5 text-xs text-fg-secondary">
            <Switch
              checked={on}
              onCheckedChange={setOn}
              disabled={analysisDisabled}
              aria-label="Analysis"
            />
            <span aria-hidden>Analysis</span>
          </label>
          <IconButton
            label="Review settings"
            icon={SETTINGS_ICON}
            size="icon-xs"
            onClick={openReviewSettingsDialog}
          />
        </>
      }
    >
      Review
    </CollapsibleHeader>
  );
}
