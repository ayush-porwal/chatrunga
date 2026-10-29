import { lazy, Suspense, useState, type ReactNode } from "react";
import { CircleHelp, Settings } from "lucide-react";
import type { RepertoireHubTab } from "@chaturanga/shared/types/repertoire-practice";
import { IconButton } from "@/components/ui/icon-button";
import { titlebarIconButton } from "@/lib/ui";
import { PageTitle } from "../../app/AppTitlebar";
import { TitlebarTabs } from "../../app/TitlebarTabs";
import { useRepertoireDueSummaryQuery } from "../../queries/repertoire";
import type { SettingsSectionId } from "../settings/SettingsPage";
import { REPERTOIRE_HUB_PANEL_ID, useRepertoireHubTab } from "./hub-tabs";

const PracticeSettingsDialog = lazy(() =>
  import("./practice/PracticeSettingsDialog").then((module) => ({
    default: module.PracticeSettingsDialog
  }))
);
const HowItWorksDialog = lazy(() =>
  import("./practice/HowItWorksDialog").then((module) => ({ default: module.HowItWorksDialog }))
);

/**
 * Repertoire's titlebar: its title, the tabs Repertoires · Practice (with the due count) ·
 * Insights, and the tab's own actions with the cog last: the repertoire settings in Settings
 * (backups) for Repertoires; How it works and Practice settings for Practice; none for Insights
 * (its filters are on the page). `leading` (the live game's button) comes before them, so the cog
 * stays last.
 */
export function RepertoireHubTitlebar({
  onOpenSettings,
  leading = null
}: {
  onOpenSettings: (section: SettingsSectionId) => void;
  leading?: ReactNode;
}) {
  const [tab, setTab] = useRepertoireHubTab();
  const due = useRepertoireDueSummaryQuery().data?.dueCount ?? 0;
  const [dialog, setDialog] = useState<"settings" | "help" | null>(null);
  const close = () => setDialog(null);
  return (
    <>
      <PageTitle>Repertoire</PageTitle>
      <TitlebarTabs<RepertoireHubTab>
        panelId={REPERTOIRE_HUB_PANEL_ID}
        ariaLabel="Repertoire"
        tabs={[
          { value: "repertoires", label: "Repertoires" },
          { value: "practice", label: "Practice", count: due },
          { value: "insights", label: "Insights" }
        ]}
        value={tab}
        onChange={setTab}
        actions={
          leading || tab !== "insights" ? (
            <>
              {leading}
              {tab === "repertoires" ? (
                <IconButton
                  label="Repertoire settings"
                  icon={<Settings />}
                  className={titlebarIconButton}
                  onClick={() => onOpenSettings("backups")}
                />
              ) : tab === "practice" ? (
                <>
                  <IconButton
                    label="How it works"
                    icon={<CircleHelp />}
                    className={titlebarIconButton}
                    onClick={() => setDialog("help")}
                  />
                  <IconButton
                    label="Practice settings"
                    icon={<Settings />}
                    className={titlebarIconButton}
                    onClick={() => setDialog("settings")}
                  />
                </>
              ) : null}
            </>
          ) : null
        }
      />
      <Suspense fallback={null}>
        {dialog === "settings" ? <PracticeSettingsDialog onClose={close} /> : null}
        {dialog === "help" ? <HowItWorksDialog onClose={close} /> : null}
      </Suspense>
    </>
  );
}
