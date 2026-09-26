import { Volume2 } from "lucide-react";
import { defaultSettings, hydratePieceSettings, type AppSettings } from "@chaturanga/shared/types/settings";
import { useSettingsQuery } from "../../queries/api";
import { playSound } from "../../sounds/sounds";
import { IconButton } from "@/components/ui/icon-button";
import { SettingRow } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { Page, PageHeader, SectionHeader } from "@/components/ui/page";
import { Switch } from "@/components/ui/switch";
import { hasDesktopApi } from "@/lib/environment";
import { useWindowGlass } from "@/lib/window-glass";
import { cardPadded } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { BoardSection } from "./BoardSettings";
import { EngineAssetsPanel } from "./EngineAssetsPanel";
import { EnginesSection } from "./EngineSettings";
import { OpenRouterSettingsCard } from "./OpenRouterSettingsCard";
import { useSetSetting } from "./use-set-setting";

export function SettingsPage() {
  const settings = useSettingsQuery();
  const desktopApiAvailable = hasDesktopApi();
  const appearance = hydratePieceSettings({ ...defaultSettings, ...(settings.data ?? {}) });
  const glass = useWindowGlass();
  const showWindowSection = Boolean(glass?.supported);

  return (
    <Page>
      <PageHeader
        title="Settings"
        description={showWindowSection ? "Window, board, sound, engines and commentary." : "Board, sound, engines and commentary."}
      />
      {!desktopApiAvailable ? (
        <Notice tone="warn">Engines, files and saved settings need the desktop app. This preview uses defaults.</Notice>
      ) : null}
      {showWindowSection ? <WindowSection appearance={appearance} reducedTransparency={Boolean(glass?.reducedTransparency)} /> : null}
      <BoardSection appearance={appearance} />
      <SoundSection appearance={appearance} />
      <EnginesSection appearance={appearance} />
      {desktopApiAvailable ? <EngineAssetsPanel /> : null}
      <section className={cn(cardPadded, "grid gap-3")}>
        <SectionHeader title="Commentary" description="Who writes the move-by-move explanations in Game review." />
        <OpenRouterSettingsCard />
      </section>
    </Page>
  );
}

/** macOS only: the translucent (vibrancy) window chrome. */
function WindowSection({ appearance, reducedTransparency }: { appearance: AppSettings; reducedTransparency: boolean }) {
  const setSetting = useSetSetting();
  return (
    <section className={cn(cardPadded, "grid gap-1")}>
      <SectionHeader title="Window" />
      <SettingRow
        label="Translucent window"
        htmlFor="setting-glass"
        description={
          reducedTransparency
            ? "Off while Reduce transparency is on in System Settings → Accessibility → Display."
            : "The sidebar and titlebar show a blurred view of your desktop."
        }
        control={
          <Switch
            id="setting-glass"
            checked={appearance.glassEffect && !reducedTransparency}
            disabled={reducedTransparency}
            onCheckedChange={(v) => setSetting("glassEffect", v)}
          />
        }
      />
    </section>
  );
}

function SoundSection({ appearance }: { appearance: AppSettings }) {
  const setSetting = useSetSetting();
  return (
    <section className={cn(cardPadded, "grid gap-1")}>
      <SectionHeader title="Sound" />
      <div className="grid divide-y divide-line-subtle">
        <SettingRow
          label="Move sounds"
          htmlFor="setting-sound"
          control={<Switch id="setting-sound" checked={appearance.soundEnabled} onCheckedChange={(v) => setSetting("soundEnabled", v)} />}
        />
        <SettingRow
          label="Volume"
          htmlFor="setting-volume"
          control={
            <>
              <input
                id="setting-volume"
                className="w-36 cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-50 sm:w-56"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={appearance.soundVolume}
                disabled={!appearance.soundEnabled}
                onChange={(event) => setSetting("soundVolume", Number(event.target.value))}
              />
              <span className="w-10 text-right text-xs tabular-nums text-fg-muted">{Math.round(appearance.soundVolume * 100)}%</span>
              <IconButton label="Test move sound" icon={<Volume2 />} onClick={() => playSound("move", appearance.soundVolume)} />
            </>
          }
        />
      </div>
    </section>
  );
}
