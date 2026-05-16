import { useMemo, useState } from "react";
import { Bot, Check, ChevronDown, Clock3, Gauge, Settings, TimerReset } from "lucide-react";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import { useEnginesQuery } from "../../queries/api";
import { useAnalysisStore } from "../../stores/analysis-store";
import { useGameStore } from "../../stores/game-store";
import { stopBrowserEngine } from "../../engine/browser-stockfish";
import type { Color } from "@chaturanga/shared/types/chess";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { localImageSrc } from "@/lib/local-image";
import {
  settingsListboxOptionActiveClass,
  settingsListboxOptionClass,
  settingsListboxPopoverClass,
  settingsListboxTriggerClass,
  settingsListboxTriggerOpenRing
} from "@/lib/settings-listbox";
import {
  empty,
  input,
  label,
  modalBackdrop,
  modalPanelCompact,
  muted
} from "@/lib/ui";

type ClockPresetId =
  | "infinite"
  | "bullet2_1"
  | "bullet3_0"
  | "blitz5_0"
  | "blitz5_3"
  | "rapid15_10"
  | "custom";

const clockPresets: Array<{
  id: ClockPresetId;
  label: string;
  description: string;
  group: "No clock" | "Bullet" | "Blitz" | "Rapid" | "Custom";
  initialSec: number | null;
  incrementSec: number;
}> = [
    {
      id: "infinite",
      label: "Infinite",
      description: "No clocks — engine uses the search cap below.",
      group: "No clock",
      initialSec: null,
      incrementSec: 0
    },
    {
      id: "bullet2_1",
      label: "2+1",
      description: "Fast clock with increment.",
      group: "Bullet",
      initialSec: 120,
      incrementSec: 1
    },
    {
      id: "bullet3_0",
      label: "3+0",
      description: "Fast clock, no increment.",
      group: "Bullet",
      initialSec: 180,
      incrementSec: 0
    },
    {
      id: "blitz5_0",
      label: "5+0",
      description: "Classic blitz.",
      group: "Blitz",
      initialSec: 300,
      incrementSec: 0
    },
    {
      id: "blitz5_3",
      label: "5+3",
      description: "Blitz with increment.",
      group: "Blitz",
      initialSec: 300,
      incrementSec: 3
    },
    {
      id: "rapid15_10",
      label: "15+10",
      description: "Longer game with increment.",
      group: "Rapid",
      initialSec: 900,
      incrementSec: 10
    },
    {
      id: "custom",
      label: "Custom",
      description: "Set minutes and increment",
      group: "Custom",
      initialSec: 600,
      incrementSec: 5
    }
  ];

const clockGroups: Array<(typeof clockPresets)[number]["group"]> = [
  "No clock",
  "Bullet",
  "Blitz",
  "Rapid",
  "Custom"
];

type EngineGameSetupProps = {
  onClose?: () => void;
  onOpenSettings: () => void;
  onStart?: () => void;
  surface?: "modal" | "page";
};

export function EngineGameControls(props: Omit<EngineGameSetupProps, "surface"> & { onClose: () => void }) {
  return (
    <div className={modalBackdrop}>
      <EngineGameSetup {...props} surface="modal" />
    </div>
  );
}

export function EngineGamePage(props: Omit<EngineGameSetupProps, "surface" | "onClose">) {
  return (
    <div className="h-full w-full overflow-auto px-8 py-7">
      <EngineGameSetup {...props} surface="page" />
    </div>
  );
}

function EngineGameSetup({
  onClose,
  onOpenSettings,
  onStart,
  surface = "modal"
}: EngineGameSetupProps) {
  const engines = useEnginesQuery();
  const game = useGameStore();
  const defaultEngine = useMemo(
    () => engines.data?.find((engine) => engine.isDefault) ?? engines.data?.[0],
    [engines.data]
  );
  const [engineId, setEngineId] = useState(defaultEngine?.id ?? "");
  const selectedEngine =
    engines.data?.find((engine) => engine.id === (engineId || defaultEngine?.id)) ?? defaultEngine;
  const [humanColor, setHumanColor] = useState<Color>(game.orientation);
  const [moveTimeMs, setMoveTimeMs] = useState(game.moveTimeMs);
  const [depth, setDepth] = useState<number | null>(game.depth);
  const [clockPreset, setClockPreset] = useState<ClockPresetId>("infinite");
  const [customMinutes, setCustomMinutes] = useState(10);
  const [customIncrementSec, setCustomIncrementSec] = useState(5);
  const selectedClockPreset = clockPresets.find((item) => item.id === clockPreset);

  function resolveClockMs(): { initialMs: number; incrementMs: number } | null {
    const preset = selectedClockPreset;
    if (!preset || preset.initialSec === null) return null;
    if (clockPreset === "custom") {
      const initialMs = Math.max(30_000, Math.round(customMinutes * 60_000));
      const incrementMs = Math.max(0, Math.round(customIncrementSec * 1000));
      return { initialMs, incrementMs };
    }
    return {
      initialMs: preset.initialSec * 1000,
      incrementMs: preset.incrementSec * 1000
    };
  }

  async function startGame() {
    const selectedEngineId = engineId || defaultEngine?.id;
    if (!selectedEngineId) {
      onOpenSettings();
      return;
    }
    if (!selectedEngine?.isAvailable) return;
    const engineColor: Color = humanColor === "white" ? "black" : "white";
    const clock = resolveClockMs();
    game.reset();
    game.setOrientation(humanColor);
    game.setGameSource("engine-game");
    const tcTag =
      clock === null
        ? "-"
        : `${Math.floor(clock.initialMs / 1000)}+${Math.floor(clock.incrementMs / 1000)}`;
    game.patchHeaders({
      event: "Casual game",
      site: "?",
      result: "*",
      timeControl: tcTag
    });
    game.setMode("engine");
    game.setEngineSide(engineColor);
    game.setEngineLimits(moveTimeMs, depth);
    game.setMatchFeedback(null);
    if (clock) {
      game.setEngineMatchClock(clock);
      game.initEngineClockLive();
    } else {
      game.setEngineMatchClock(null);
    }
    useAnalysisStore.getState().setActiveEngine(selectedEngineId);
    useAnalysisStore.getState().setError(null);
    useAnalysisStore.getState().setStatus("ready");
    onStart?.();
    onClose?.();
  }

  async function stop() {
    if (!window.chaturanga) {
      stopBrowserEngine();
      useAnalysisStore.getState().reset();
      game.setMode("freeplay");
      game.setEngineSide(null);
      game.clearEngineMatchExtras();
      return;
    }
    await window.chaturanga.engines.stop();
    useAnalysisStore.getState().reset();
    game.setMode("freeplay");
    game.setEngineSide(null);
    game.clearEngineMatchExtras();
  }

  const timed = clockPreset !== "infinite";
  const pageMode = surface === "page";

  return (
      <div
        className={cn(
          surface === "modal"
            ? cn(modalPanelCompact, "w-[min(620px,calc(100vw-40px))]")
            : "mx-auto grid min-h-full w-full max-w-6xl content-start gap-6 overflow-visible pb-24"
        )}
      >
        <div className={cn("flex items-start justify-between gap-4", !pageMode && "mb-3.5")}>
          <div className="grid gap-1">
            <h2 className={cn("font-semibold text-[#f4f1ea]", pageMode ? "text-[26px] tracking-[-0.01em]" : "text-[15px]")}>
              Engine game
            </h2>
            <p className={cn(muted, pageMode ? "max-w-2xl text-sm leading-6" : "text-xs")}>
              Choose your side, clock, and engine search behavior before starting the match.
            </p>
          </div>
          {onClose ? (
            <Button type="button" variant="outline" size="sm" onClick={onClose}>Close</Button>
          ) : null}
        </div>
        {engines.data?.length ? (
          <div className={cn("grid gap-6", pageMode && "xl:grid-cols-[minmax(0,1fr)_390px]")}>
            <section className={cn("grid gap-5 border-white/10", pageMode ? "rounded-none border-0 bg-transparent p-0" : "rounded-lg border bg-[#191b1f] p-3")}>
              <div className="flex items-center gap-2 text-sm font-semibold text-[#f4f1ea]">
                <Gauge size={16} />
                Match setup
              </div>
              <div className="grid gap-1.5">
                <span className="text-sm text-[#d8d8d8]">Play as</span>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    className={cn(
                      "flex min-h-[60px] items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.045] px-4 py-3 text-left transition-colors hover:bg-white/[0.07]",
                      humanColor === "white" && "border-[#8caf7d] bg-[#263527]/80"
                    )}
                    onClick={() => setHumanColor("white")}
                  >
                    <span className="flex items-center gap-3">
                      <span className="h-5 w-5 rounded-full bg-[#efe7d2] shadow-[0_0_0_1px_rgb(0_0_0/0.35)]" />
                      <span className="grid gap-0.5">
                        <strong className="text-sm text-[#f4f1ea]">White</strong>
                        <span className="text-[12px] text-[#a9adb4]">You move first</span>
                      </span>
                    </span>
                    {humanColor === "white" ? <Check size={16} className="text-[#d7e8c5]" /> : null}
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "flex min-h-[60px] items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.045] px-4 py-3 text-left transition-colors hover:bg-white/[0.07]",
                      humanColor === "black" && "border-[#8caf7d] bg-[#263527]/80"
                    )}
                    onClick={() => setHumanColor("black")}
                  >
                    <span className="flex items-center gap-3">
                      <span className="h-5 w-5 rounded-full bg-[#2b3036] shadow-[inset_0_1px_1px_rgb(255_255_255/0.10),0_0_0_1px_rgb(255_255_255/0.18)]" />
                      <span className="grid gap-0.5">
                        <strong className="text-sm text-[#f4f1ea]">Black</strong>
                        <span className="text-[12px] text-[#a9adb4]">Engine starts</span>
                      </span>
                    </span>
                    {humanColor === "black" ? <Check size={16} className="text-[#d7e8c5]" /> : null}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#f4f1ea]">
                  <Clock3 size={16} />
                  Time control
                </div>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-[#a9adb4]">
                  {selectedClockPreset?.label ?? "Infinite"}
                </span>
              </div>
              <div className="grid gap-2">
                {clockGroups.map((group) => {
                  const presets = clockPresets.filter((preset) => preset.group === group);
                  return (
                    <div key={group} className="grid gap-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#727982]">
                        {group}
                      </span>
                      <div className={cn("grid gap-2", presets.length > 1 && "sm:grid-cols-2", pageMode && presets.length > 1 && "xl:grid-cols-3")}>
                        {presets.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            className={cn(
                              "grid min-h-[64px] grid-cols-[1fr_auto] items-center gap-2 rounded-lg border border-white/10 bg-white/[0.045] p-3 text-left text-[13px] text-[#e8e8e8] transition-colors hover:bg-white/[0.07]",
                              clockPreset === preset.id && "border-[#8caf7d] bg-[#263527]/80"
                            )}
                            onClick={() => setClockPreset(preset.id)}
                          >
                            <span className="grid gap-0.5">
                              <strong className="text-[14px] text-[#f4f1ea]">{preset.label}</strong>
                              <span className="text-[11px] leading-snug text-[#a9adb4]">
                                {preset.description}
                              </span>
                            </span>
                            {clockPreset === preset.id ? <Check size={15} /> : null}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {clockPreset === "custom" ? (
                <div className="grid gap-2 rounded-lg border border-[#353535] bg-[#202020] p-2.5 sm:grid-cols-2">
                  <label className={label}>
                    Minutes per side
                    <span className="-mt-1 text-[11px] text-transparent">Minutes</span>
                    <input
                      className={input}
                      type="number"
                      min={0.5}
                      step={0.5}
                      value={customMinutes}
                      onChange={(event) => setCustomMinutes(Number(event.target.value))}
                    />
                  </label>
                  <label className={label}>
                    Increment
                    <span className="-mt-1 text-[11px] text-[#727982]">Seconds per move</span>
                    <input
                      className={input}
                      type="number"
                      min={0}
                      value={customIncrementSec}
                      onChange={(event) => setCustomIncrementSec(Number(event.target.value))}
                    />
                  </label>
                </div>
              ) : null}
            </section>

            <aside className={cn("grid content-start gap-4", pageMode ? "xl:sticky xl:top-0" : "")}>
              <section className="grid gap-3 rounded-[12px] border border-white/10 bg-[#181a1d]/95 p-4 shadow-[0_14px_38px_rgb(0_0_0/0.22)]">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#f4f1ea]">
                  <Bot size={16} />
                  Engine
                </div>
                <EngineDropdown
                  engines={engines.data}
                  value={engineId || defaultEngine?.id || ""}
                  onChange={setEngineId}
                />
                <div className="grid grid-cols-2 gap-2 text-[12px]">
                  <EngineMeta label="Side" value={humanColor === "white" ? "Black" : "White"} />
                  <EngineMeta label="Clock" value={selectedClockPreset?.label ?? "Infinite"} />
                </div>
                <Button type="button" variant="outline" className="justify-start" onClick={onOpenSettings}>
                  <Settings size={16} />
                  Engine settings
                </Button>
              </section>

              <section className="grid gap-3 rounded-[12px] border border-white/10 bg-[#181a1d]/95 p-4 shadow-[0_14px_38px_rgb(0_0_0/0.22)]">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#f4f1ea]">
                  <TimerReset size={16} />
                  Engine search
                </div>
                <div className={cn("grid gap-3", timed && "opacity-65")}>
                  <label className={label}>
                    Move time
                    <span className="-mt-1 text-[11px] text-[#727982]">Milliseconds</span>
                    <input
                      className={input}
                      type="number"
                      min={100}
                      value={moveTimeMs}
                      disabled={timed}
                      onChange={(event) => setMoveTimeMs(Number(event.target.value))}
                    />
                  </label>
                  <label className={label}>
                    Depth
                    <span className="-mt-1 text-[11px] text-[#727982]">Optional cap</span>
                    <input
                      className={input}
                      type="number"
                      min={1}
                      value={depth ?? ""}
                      placeholder="Optional"
                      disabled={timed}
                      onChange={(event) => setDepth(event.target.value ? Number(event.target.value) : null)}
                    />
                  </label>
                </div>
                <p className={cn(muted, "text-xs")}>
                  {timed
                    ? "Clocked games use UCI clock fields, so fixed move time and depth are disabled."
                    : "Untimed games use the move time or depth cap for each engine move."}
                </p>
              </section>

              <section className="grid gap-2 rounded-[12px] border border-white/10 bg-[#181a1d]/95 p-4 shadow-[0_14px_38px_rgb(0_0_0/0.22)]">
                <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#727982]">
                  Start condition
                </span>
                <p className="text-sm leading-6 text-[#d8dbe0]">
                  {humanColor === "black"
                    ? "The engine will make the first move as White."
                    : "You will make the first move as White."}
                </p>
              </section>

              {!pageMode ? (
                <ActionButtons
                  canStart={Boolean(selectedEngine?.isAvailable)}
                  onStart={startGame}
                  onStop={stop}
                />
              ) : null}
            </aside>
            {pageMode ? (
              <div className="fixed bottom-0 left-[var(--sidebar-width)] right-0 z-20 border-t border-white/10 bg-[#111315]/95 px-8 py-3 backdrop-blur">
                <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
                  <p className="min-w-0 truncate text-sm text-[#a9adb4]">
                    {humanColor === "black"
                      ? "Engine moves first as White."
                      : "You move first as White."}
                  </p>
                  <ActionButtons
                    canStart={Boolean(selectedEngine?.isAvailable)}
                    onStart={startGame}
                    onStop={stop}
                  />
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-3.5 grid gap-3">
            <p className={empty}>No UCI engine is configured.</p>
            <Button type="button" variant="secondary" onClick={onOpenSettings}>Open settings</Button>
          </div>
        )}
      </div>
  );
}

function EngineMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.04em] text-[#727982]">
        {label}
      </span>
      <strong className="truncate text-[#f4f1ea]">{value}</strong>
    </div>
  );
}

function EngineDropdown({
  engines,
  onChange,
  value
}: {
  engines: EngineConfig[];
  onChange: (engineId: string) => void;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = engines.find((engine) => engine.id === value) ?? engines[0];
  return (
    <div className="relative grid gap-1.5">
      <span className="text-[13px] text-[#d8d8d8]">Opponent</span>
      <button
        type="button"
        className={cn(settingsListboxTriggerClass, open && settingsListboxTriggerOpenRing)}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <EngineLogo engine={selected} />
          <span className="grid min-w-0 gap-0.5">
            <strong className="truncate text-sm">{selected?.name ?? "Select engine"}</strong>
            <span className="truncate text-[11px] text-[#727982]">
              {selected?.isDefault ? "Default engine" : selected ? "UCI engine" : "No engine selected"}
            </span>
          </span>
        </span>
        <ChevronDown
          size={16}
          className={cn("shrink-0 text-[#a9adb4] transition-transform", open && "rotate-180")}
        />
      </button>
      {open ? (
        <div className={cn(settingsListboxPopoverClass, "left-0 right-0")} role="listbox">
          {engines.map((engine) => {
            const active = engine.id === selected?.id;
            return (
              <button
                key={engine.id}
                type="button"
                role="option"
                aria-selected={active}
                disabled={!engine.isAvailable}
                className={cn(
                  settingsListboxOptionClass,
                  active && settingsListboxOptionActiveClass,
                  !engine.isAvailable && "cursor-not-allowed opacity-55 hover:bg-transparent"
                )}
                onClick={() => {
                  onChange(engine.id);
                  setOpen(false);
                }}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <EngineLogo engine={engine} />
                  <span className="grid min-w-0 gap-0.5">
                    <strong className="truncate font-medium">{engine.name}</strong>
                    <span className="truncate text-[11px] text-[#8f959d]">
                      {engineSubtitle(engine)}
                    </span>
                  </span>
                </span>
                {active ? <Check size={15} className="shrink-0 text-[#d7e8c5]" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function engineSubtitle(engine: EngineConfig): string {
  const runtime =
    engine.runtime === "wasm"
      ? "WASM"
      : engine.runtime === "native-bundled"
        ? "Bundled"
        : "Custom UCI";
  const status = engine.isAvailable ? (engine.isDefault ? "Default" : "Configured") : "Unavailable";
  return `${status} · ${runtime}`;
}

function EngineLogo({ engine }: { engine: EngineConfig | undefined }) {
  const src = localImageSrc(engine?.imagePath);
  return (
    <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md border border-white/10 bg-[#263527] text-[#cce6b2]">
      {src ? <img className="h-full w-full object-cover" src={src} alt="" /> : <Bot size={15} />}
    </span>
  );
}

function ActionButtons({
  canStart,
  onStart,
  onStop
}: {
  canStart: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button type="button" variant="outline" className="w-24 justify-center" onClick={onStop}>Stop</Button>
      <Button type="button" variant="secondary" className="w-24 justify-center" disabled={!canStart} onClick={onStart}>Start</Button>
    </div>
  );
}
