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
import { cardPadded } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { BoardSection } from "./BoardSettings";
import { EngineAssetsPanel } from "./EngineAssetsPanel";
import { EnginesSection } from "./EngineSettings";
import { OpenRouterSettingsCard } from "./OpenRouterSettingsCard";
import { LichessAccountSection } from "../lichess/LichessAccount";
import { UpdatesSection } from "../updates/UpdatesSection";
import { UsageDataSection } from "./UsageDataSection";
import { useOnboardingSession } from "../onboarding/useOnboarding";
import { useSettingsSaveState } from "./settings-save-state";
import { useSetSetting } from "./use-set-setting";

export type SettingsSectionId =
  | "board"
  | "sound"
  | "engines"
  | "downloads"
  | "commentary"
  | "lichess"
  | "updates"
  | "usage"
  | "welcome";
type SectionId = SettingsSectionId;

const sectionDomId = (id: SectionId) => `settings-${id}`;

export const SettingsPage = memo(function SettingsPage({
  initialSection = null,
  onSectionChange
}: {
  /** Section to show when the page opens (e.g. Commentary from Game review's "Add API key"). */
  initialSection?: SettingsSectionId | null;
  /** The section being read changed (the scroll position): Back returns to it. */
  onSectionChange?: (section: SettingsSectionId) => void;
}) {
  const settings = useSettingsQuery();
  const desktopApiAvailable = hasDesktopApi();
  const appearance = hydratePieceSettings({ ...defaultSettings, ...settings.data });
  // In page order (the scroll spy reports the one being read).
  const sections: SectionId[] = [
    "board",
    "sound",
    ...(desktopApiAvailable ? (["lichess"] as const) : []),
    "engines",
    ...(desktopApiAvailable ? (["downloads"] as const) : []),
    "commentary",
    ...(desktopApiAvailable ? (["updates", "usage", "welcome"] as const) : [])
  ];
  const contentRef = useRef<HTMLDivElement>(null);
  const active = useScrollSpy(contentRef, sections);
  useEffect(() => {
    onSectionChange?.(active);
  }, [active, onSectionChange]);

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
      <PageHeader title="Settings" actions={<SaveStatus />} />
      {!desktopApiAvailable ? (
        <Notice tone="warn">Engines, files and saved settings need the desktop app. This preview uses defaults.</Notice>
      ) : null}
      {/* Full width: large cards span both columns; the smaller ones pair up on a wide window. */}
      <div ref={contentRef} className="@container grid gap-10">
        <SettingsGroup title="Board & play">
          <SectionAnchor id="board" wide>
            <BoardSection appearance={appearance} />
          </SectionAnchor>
          <SectionAnchor id="sound">
            <SoundSection appearance={appearance} />
          </SectionAnchor>
          {desktopApiAvailable ? (
            <SectionAnchor id="lichess">
              <LichessAccountSection />
            </SectionAnchor>
          ) : null}
        </SettingsGroup>

        <SettingsGroup title="Engines & commentary">
          <SectionAnchor id="engines" wide>
            <EnginesSection appearance={appearance} />
          </SectionAnchor>
          {desktopApiAvailable ? (
            <SectionAnchor id="downloads" wide>
              <EngineAssetsPanel />
            </SectionAnchor>
          ) : null}
          <SectionAnchor id="commentary" wide>
            <section className={cn(cardPadded, "grid content-start gap-4")}>
              <SectionHeader title="Commentary" description="Game review explains each move with an AI model, through your own OpenRouter account." />
              {/* A form reads best at a comfortable width, not stretched across the page. */}
              <div className="max-w-2xl">
                <OpenRouterSettingsCard />
              </div>
            </section>
          </SectionAnchor>
        </SettingsGroup>

        {desktopApiAvailable ? (
          <SettingsGroup title="App">
            <SectionAnchor id="updates">
              <UpdatesSection appearance={appearance} />
            </SectionAnchor>
            <SectionAnchor id="usage">
              <UsageDataSection appearance={appearance} />
            </SectionAnchor>
            <SectionAnchor id="welcome" wide>
              <WelcomeSection />
            </SectionAnchor>
          </SettingsGroup>
        ) : null}
      </div>
    </Page>
  );
});

/** A titled group of setting cards: one column, two on a wide panel. */
function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3" aria-label={title}>
      <h2 className="text-xs font-medium tracking-wide text-fg-muted uppercase">{title}</h2>
      <div className="grid gap-4 @4xl:grid-cols-2">{children}</div>
    </section>
  );
}

/** A card's anchor (deep links, Back to the section being read); `wide` spans both columns. */
function SectionAnchor({ id, wide = false, children }: { id: SectionId; wide?: boolean; children: ReactNode }) {
  return (
    <div
      id={sectionDomId(id)}
      data-settings-section={id}
      // Paired cards share their row's height.
      className={cn("grid min-w-0 scroll-mt-6 [&>*]:h-full", wide && "@4xl:col-span-2")}
    >
      {children}
    </div>
  );
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
      // the second one's top cross the threshold.
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
                onChange={(event) => setSetting("soundVolume", Number(event.target.value), { batch: true })}
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
