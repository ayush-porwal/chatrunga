import { Settings } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { CollapsibleHeader, type Collapsible } from "@/components/ui/collapsible-section";
import { openReviewSettingsDialog } from "./ReviewSettingsDialog";

const SETTINGS_ICON = <Settings />;

/**
 * The review panel's heading row, the twin of the charts' "Winning chances" header: "⌄ Game Review"
 * folds the tabs and their content away (the charts take the space), and the review settings
 * gear sits at its end. Game Review runs no live engine: its Engine tab shows the review's lines.
 */
export function ReviewPanelHeader({ section }: { section: Collapsible }) {
  return (
    <CollapsibleHeader
      open={section.open}
      onToggle={section.toggle}
      controls={section.contentId}
      actions={
        <IconButton
          label="Review settings"
          icon={SETTINGS_ICON}
          size="icon-sm"
          className="text-fg-muted"
          onClick={openReviewSettingsDialog}
        />
      }
    >
      Game Review
    </CollapsibleHeader>
  );
}
