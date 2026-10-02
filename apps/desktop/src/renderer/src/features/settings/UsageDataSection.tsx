import { useEffect, useState } from "react";
import type { AppSettings } from "@chaturanga/shared/types/settings";
import type {
  TelemetryStatus,
  TelemetryUnavailableReason
} from "@chaturanga/shared/types/telemetry";
import { SettingRow } from "@/components/ui/field";
import { SectionHeader } from "@/components/ui/page";
import { Switch } from "@/components/ui/switch";
import { cardPadded } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useSetSetting } from "./use-set-setting";

const unavailableText: Record<TelemetryUnavailableReason, string> = {
  not_configured: "This build doesn't include usage analytics, so nothing can be sent.",
  disabled_by_environment: "Turned off on this computer (CHATURANGA_TELEMETRY_ENABLED=false).",
  development: "Not sent from development or test runs."
};

/**
 * Settings → Usage data: the opt-in for anonymous usage analytics (off by default). What it
 * collects is listed in docs/telemetry.md; turning it off deletes events not sent yet.
 */
export function UsageDataSection({ appearance }: { appearance: AppSettings }) {
  const setSetting = useSetSetting();
  const [status, setStatus] = useState<TelemetryStatus | null>(null);
  const enabled = appearance.usageAnalyticsEnabled;

  useEffect(() => {
    let current = true;
    void window.chaturanga?.telemetry
      ?.status()
      .then((next) => {
        if (current) setStatus(next);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [enabled]);

  const unavailable = status && !status.available ? status.reason : null;
  return (
    <section className={cn(cardPadded, "grid gap-2")}>
      <SectionHeader
        title="Usage data"
        description="Help improve Chaturanga by sharing which features are used — never your games, names, files or keys."
      />
      <div className="grid divide-y divide-line-subtle">
        <SettingRow
          label="Share anonymous usage data"
          htmlFor="setting-usage-analytics"
          description={
            unavailable
              ? unavailableText[unavailable]
              : "Counts such as reviews run, explanations viewed and days the app is used, with a random id for this installation. Off removes anything not sent yet."
          }
          control={
            <Switch
              id="setting-usage-analytics"
              checked={enabled}
              onCheckedChange={(value) => setSetting("usageAnalyticsEnabled", value)}
            />
          }
        />
      </div>
    </section>
  );
}
