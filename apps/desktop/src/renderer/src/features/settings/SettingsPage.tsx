import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, CircleAlert, Loader2, Sparkles, Volume2 } from "lucide-react";
import { defaultSettings, hydratePieceSettings, type AppSettings } from "@chaturanga/shared/types/settings";
import { useSettingsQuery } from "../../queries/api";
import { playSound } from "../../sounds/sounds";
import { Button } from "@/components/ui/button";
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
import { LichessAccountSection } from "../lichess/LichessAccount";
import { UpdatesSection } from "../updates/UpdatesSection";
import { useOnboardingSession } from "../onboarding/useOnboarding";
import { useSettingsSaveState } from "./settings-save-state";
import { useSetSetting } from "./use-set-setting";

export type SettingsSectionId = "window" | "board" | "sound" | "engines" | "downloads" | "commentary" | "lichess" | "updates" | "welcome";
type SectionId = SettingsSectionId;

const sectionLabels: Record<SectionId, string> = {
  window: "Window",
  board: "Board",
  sound: "Sound",
  engines: "Engines",
  downloads: "Engine downloads",
  commentary: "Commentary",
  lichess: "Lichess",
  updates: "Updates",
  welcome: "Getting started"
};

const sectionDomId = (id: SectionId) => `settings-${id}`;

export const SettingsPage = memo(function SettingsPage({
  initialSection = null
}: {
  /** Section to show when the page opens (e.g. Commentary from Game review's "Add API key"). */
  initialSection?: SettingsSectionId | null;
}) {
  const settings = useSettingsQuery();
  const desktopApiAvailable = hasDesktopApi();
  const appearance = hydratePieceSettings({ ...defaultSettings, ...(settings.data ?? {}) });
  const glass = useWindowGlass();
  const showWindowSection = Boolean(glass?.supported);
  const sections: SectionId[] = [
    ...(showWindowSection ? (["window"] as const) : []),
    "board",
    "sound",
    "engines",
    ...(desktopApiAvailable ? (["downloads"] as const) : []),
    "commentary",
    ...(desktopApiAvailable ? (["lichess", "updates", "welcome"] as const) : [])
  ];
  const navRef = useRef<HTMLElement>(null);
  const active = useScrollSpy(navRef, sections);

  useEffect(() => {
    // Jump (no smooth scroll) once the page has laid out, so it opens at the requested section.
    if (!initialSection) return;
    const frame = window.requestAnimationFrame(() =>
      document.getElementById(sectionDomId(initialSection))?.scrollIntoView({ block: "start" })
    );
    return () => window.cancelAnimationFrame(frame);
  }, [initialSection]);

  return (
    <Page>
      <PageHeader title="Settings" />
      {!desktopApiAvailable ? (
        <Notice tone="warn">Engines, files and saved settings need the desktop app. This preview uses defaults.</Notice>
      ) : null}
      <div className="@container">
        <SaveStatus className="mb-3 justify-end @4xl:hidden" />
        <div className="grid gap-8 @4xl:grid-cols-[9.5rem_minmax(0,1fr)]">
          {/* Section index: sticky beside the cards on wide panels, hidden when the column would crowd them. */}
          <nav
            ref={navRef}
            aria-label="Settings sections"
            className="sticky top-(--page-gutter-y) hidden self-start pt-0.5 @4xl:grid @4xl:gap-6"
          >
            <ul className="grid gap-0.5">
              {sections.map((id) => (
                <li key={id}>
                  <a
                    href={`#${sectionDomId(id)}`}
                    aria-current={active === id ? "location" : undefined}
                    onClick={(event) => {
                      event.preventDefault();
                      scrollToSection(id);
                    }}
                    className={cn(
                      "relative flex h-8 items-center rounded-md pl-3 text-sm outline-none transition-colors duration-micro focus-visible:ring-2 focus-visible:ring-accent/50",
                      active === id ? "text-fg" : "text-fg-muted hover:text-fg-secondary"
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent transition-[opacity,transform] duration-standard ease-spring",
                        active === id ? "scale-y-100 opacity-100" : "scale-y-50 opacity-0"
                      )}
                    />
                    <span className="truncate">{sectionLabels[id]}</span>
                  </a>
                </li>
              ))}
            </ul>
            <SaveStatus className="pl-3" />
          </nav>

          <div className="grid min-w-0 gap-6">
            {showWindowSection ? (
              <SectionAnchor id="window">
                <WindowSection appearance={appearance} reducedTransparency={Boolean(glass?.reducedTransparency)} />
              </SectionAnchor>
            ) : null}
            <SectionAnchor id="board">
              <BoardSection appearance={appearance} />
            </SectionAnchor>
            <SectionAnchor id="sound">
              <SoundSection appearance={appearance} />
            </SectionAnchor>
            <SectionAnchor id="engines">
              <EnginesSection appearance={appearance} />
            </SectionAnchor>
            {desktopApiAvailable ? (
              <SectionAnchor id="downloads">
                <EngineAssetsPanel />
              </SectionAnchor>
            ) : null}
            <SectionAnchor id="commentary">
              <section className={cn(cardPadded, "grid gap-4")}>
                <SectionHeader title="Commentary" description="Game review explains each move with an AI model, through your own OpenRouter account." />
                <OpenRouterSettingsCard />
              </section>
            </SectionAnchor>
            {desktopApiAvailable ? (
              <SectionAnchor id="lichess">
                <LichessAccountSection />
              </SectionAnchor>
            ) : null}
            {desktopApiAvailable ? (
              <SectionAnchor id="updates">
                <UpdatesSection appearance={appearance} />
              </SectionAnchor>
            ) : null}
            {desktopApiAvailable ? (
              <SectionAnchor id="welcome">
                <WelcomeSection />
              </SectionAnchor>
            ) : null}
          </div>
        </div>
      </div>
    </Page>
  );
});

function SectionAnchor({ id, children }: { id: SectionId; children: ReactNode }) {
  return (
    <div id={sectionDomId(id)} data-settings-section={id} className="min-w-0 scroll-mt-6">
      {children}
    </div>
  );
}

function scrollToSection(id: SectionId) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(sectionDomId(id))?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

/**
 * The section whose top has passed the upper third of the page scroller (the first one at the top,
 * the last one once the page is scrolled to the end). Scroll-driven, one rAF per frame at most.
 */
function useScrollSpy(anchorRef: React.RefObject<HTMLElement | null>, sections: readonly SectionId[]): SectionId {
  const [active, setActive] = useState<SectionId>(sections[0] ?? "board");
  const key = sections.join(",");
  const measure = useCallback(
    (scroller: HTMLElement) => {
      const top = scroller.getBoundingClientRect().top;
      const threshold = top + scroller.clientHeight / 3;
      let current = sections[0];
      for (const id of sections) {
        const element = document.getElementById(sectionDomId(id));
        if (element && element.getBoundingClientRect().top <= threshold) current = id;
      }
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) current = sections[sections.length - 1];
      // At the very top the first section is the one being read, even when a short first card lets
      // the second one's top cross the threshold (Window above Board).
      if (scroller.scrollTop <= 4) current = sections[0];
      if (current) setActive(current);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for the section list
    [key]
  );

  useEffect(() => {
    const scroller = anchorRef.current?.closest<HTMLElement>(".scroll-area");
    if (!scroller) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure(scroller);
      });
    };
    measure(scroller);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      window.cancelAnimationFrame(frame);
    };
  }, [anchorRef, measure]);

  return active;
}

/** How long "Saved" stays up after the last change before settling back to the quiet hint. */
const SAVED_VISIBLE_MS = 2200;

/** Autosave status: Saving… → Saved (briefly) → "Changes save automatically". */
function SaveStatus({ className }: { className?: string }) {
  const { pending, settledAt, failed } = useSettingsSaveState();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!settledAt) return;
    setNow(Date.now());
    const timer = window.setTimeout(() => setNow(Date.now()), SAVED_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [settledAt]);
  const recent = settledAt !== null && now - settledAt < SAVED_VISIBLE_MS;
  const kind = pending > 0 ? "saving" : failed && settledAt ? "failed" : recent ? "saved" : "idle";

  return (
    <p role="status" aria-live="polite" className={cn("flex h-5 items-center gap-1.5 text-xs", className)}>
      {kind === "saving" ? (
        <span key="saving" className="flex items-center gap-1.5 text-fg-muted">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Saving…
        </span>
      ) : kind === "saved" ? (
        <span key="saved" className="flex animate-rise-in items-center gap-1.5 text-accent">
          <Check className="size-3.5" aria-hidden="true" />
          Saved
        </span>
      ) : kind === "failed" ? (
        <span key="failed" className="flex animate-rise-in items-center gap-1.5 text-danger">
          <CircleAlert className="size-3.5" aria-hidden="true" />
          Couldn’t save
        </span>
      ) : (
        <span key="idle" className="animate-fade-in text-fg-subtle">
          Changes save automatically
        </span>
      )}
    </p>
  );
}

/** macOS only: the translucent (vibrancy) window chrome. */
function WindowSection({ appearance, reducedTransparency }: { appearance: AppSettings; reducedTransparency: boolean }) {
  const setSetting = useSetSetting();
  return (
    <section className={cn(cardPadded, "grid gap-2")}>
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
    <section className={cn(cardPadded, "grid gap-2")}>
      <SectionHeader title="Sound" />
      <div className="grid divide-y divide-line-subtle">
        <SettingRow
          label="Move sounds"
          htmlFor="setting-sound"
          description="Moves, captures and the end of a game."
          control={<Switch id="setting-sound" checked={appearance.soundEnabled} onCheckedChange={(v) => setSetting("soundEnabled", v)} />}
        />
        <SettingRow
          label="Volume"
          htmlFor="setting-volume"
          className={cn("transition-opacity duration-standard", !appearance.soundEnabled && "opacity-60")}
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
              <IconButton
                label="Test move sound"
                icon={<Volume2 />}
                disabled={!appearance.soundEnabled}
                onClick={() => playSound("move", appearance.soundVolume)}
              />
            </>
          }
        />
      </div>
    </section>
  );
}

/** Reopens the first-run welcome (engines, level, AI coach). */
function WelcomeSection() {
  const reopen = useOnboardingSession((state) => state.reopen);
  return (
    <section className={cn(cardPadded, "grid gap-2")}>
      <SectionHeader title="Getting started" />
      <SettingRow
        label="Welcome"
        description="Go through setup again: engines, your level and the AI coach."
        control={
          <Button variant="outline" size="sm" onClick={reopen}>
            <Sparkles />
            Show welcome again
          </Button>
        }
      />
    </section>
  );
}
