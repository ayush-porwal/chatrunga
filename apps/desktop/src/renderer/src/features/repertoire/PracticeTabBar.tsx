import { Settings } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { WorkspaceTabBar } from "../board/WorkspaceTabBar";

const SETTINGS_ICON = <Settings />;

/**
 * Practice's panel title bar (as Review's): the one tab it shows (`label`), and the repertoire
 * settings' cog, last.
 */
export function PracticeTabBar({
  panelId,
  label,
  onSettings
}: {
  panelId: string;
  label: string;
  onSettings: () => void;
}) {
  return (
    <WorkspaceTabBar
      panelId={panelId}
      ariaLabel="Practice panels"
      tabs={[{ value: "practice", label }]}
      value="practice"
      onChange={() => undefined}
      actions={
        <IconButton
          label="Repertoire settings"
          icon={SETTINGS_ICON}
          size="icon-xs"
          onClick={onSettings}
        />
      }
    />
  );
}
