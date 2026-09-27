import { memo, useCallback, useMemo, useRef, useState } from "react";
import { Bot, Check, ChevronDown, Globe, Play, Settings, SquareDashed } from "lucide-react";
import { isManagedEngine } from "@chaturanga/shared/engine/managed";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import { useEnginesQuery } from "../../queries/api";
import { useAnalysisStore } from "../../stores/analysis-store";
import { useGameStore } from "../../stores/game-store";
import { selectLiveGameInProgress, useLichessStore, type PlayOpponent } from "../../stores/lichess-store";
import { LichessPlayActions, LichessPlayPanel, useLichessSeekSetup } from "../lichess/LichessPlayPanel";
import type { Color } from "@chaturanga/shared/types/chess";
import { ChipButton } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Eyebrow, Page, PageHeader } from "@/components/ui/page";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SideDot } from "@/components/ui/side-dot";
import { cn } from "@/lib/utils";
import { localImageSrc } from "@/lib/local-image";
import {
  settingsListboxOptionActiveClass,
  settingsListboxOptionClass,
  settingsListboxPopoverClass,
  settingsListboxTriggerClass,
  settingsListboxTriggerOpenRing
} from "@/lib/settings-listbox";
import { cardPadded, fieldLabel } from "@/lib/ui";
import { useDismiss } from "@/lib/use-dismiss";

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
  group: "No clock" | "Bullet" | "Blitz" | "Rapid" | "Custom";
  initialSec: number | null;
  incrementSec: number;
}> = [
  { id: "infinite", label: "Infinite", group: "No clock", initialSec: null, incrementSec: 0 },
  { id: "bullet2_1", label: "2+1", group: "Bullet", initialSec: 120, incrementSec: 1 },
  { id: "bullet3_0", label: "3+0", group: "Bullet", initialSec: 180, incrementSec: 0 },
  { id: "blitz5_0", label: "5+0", group: "Blitz", initialSec: 300, incrementSec: 0 },
  { id: "blitz5_3", label: "5+3", group: "Blitz", initialSec: 300, incrementSec: 3 },
  { id: "rapid15_10", label: "15+10", group: "Rapid", initialSec: 900, incrementSec: 10 },
  // Custom uses the minutes/increment fields; initialSec only marks it as timed.
  { id: "custom", label: "Custom", group: "Custom", initialSec: 600, incrementSec: 5 }
];

const clockGroups: Array<(typeof clockPresets)[number]["group"]> = [
  "No clock",
  "Bullet",
  "Blitz",
  "Rapid",
  "Custom"
];

type EngineGameSetupProps = {
  onOpenSettings: () => void;
  onStart: () => void;
};

const opponentOptions = [
  { value: "lichess", label: "Lichess", icon: <Globe /> },
  { value: "engine", label: "Engine", icon: <Bot /> },
  { value: "board", label: "Free board", icon: <SquareDashed /> }
] as const;

const opponentDescriptions: Record<PlayOpponent, string> = {
  lichess: "Rated and casual games on lichess.org.",
  engine: "Play against any installed UCI engine.",
  board: "An empty board: play both sides, try ideas, no clock."
};

/**
 * Play: every way to start a game. On Lichess (quick pairing or a challenge), against an engine on
 * this computer (pick it, a side and a clock), or a free board.
 */
export const PlayPage = memo(function PlayPage(
  props: EngineGameSetupProps & { onOpenLichessGame: () => void; onFreeBoard: () => void }
) {
  const setup = useEngineGameSetup(props);
  const lichess = useLichessSeekSetup();
  const chosen = useLichessStore((state) => state.playOpponent);
  const connected = useLichessStore((state) => Boolean(state.status.account));
  const setOpponent = useLichessStore((state) => state.setPlayOpponent);
  const opponent = chosen ?? (connected ? "lichess" : "engine");
  const onlineGameLive = useLichessStore(selectLiveGameInProgress);
  return (
    <Page>
      {/* Start sits in the header like every page's primary action (Puzzles, Home). */}
      <PageHeader
        title="Play"
        description={opponentDescriptions[opponent]}
        actions={
          opponent === "lichess" ? (
            <LichessPlayActions setup={lichess} />
          ) : opponent === "board" ? (
            <Button type="button" variant="primary" disabled={onlineGameLive} onClick={props.onFreeBoard}>
              <Play />
              Open board
            </Button>
          ) : setup.hasEngines ? (
            <SetupActions setup={setup} />
          ) : undefined
        }
      />
      <SegmentedControl ariaLabel="Opponent" value={opponent} onChange={setOpponent} options={opponentOptions} className="w-fit" />
      {opponent === "lichess" ? (
        <LichessPlayPanel setup={lichess} onOpenGame={props.onOpenLichessGame} />
      ) : opponent === "engine" ? (
        <section className={cardPadded}>
          <EngineGameSetupBody setup={setup} onOpenSettings={props.onOpenSettings} />
        </section>
      ) : null}
    </Page>
  );
});

type EngineGameSetupState = ReturnType<typeof useEngineGameSetup>;

function useEngineGameSetup({ onOpenSettings, onStart }: EngineGameSetupProps) {
  const engines = useEnginesQuery();
  // Actions and initial values only; `matchRunning` is the one live value the page renders.
  const game = useGameStore.getState();
  const matchRunning = useGameStore((state) => state.mode === "engine" && Boolean(state.engineSide) && !state.gameOutcome);
  // A Lichess game owns the board until it ends.
  const onlineGameLive = useLichessStore(selectLiveGameInProgress);
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

  function resolveClockMs(): { initialMs: number; incrementMs: number } | null {
    const preset = clockPresets.find((item) => item.id === clockPreset);
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

  function startGame() {
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
      timeControl: tcTag,
      // Named sides: the titlebar, board labels and saved game keep the engine's name after the game ends.
      white: engineColor === "white" ? selectedEngine.name : "You",
      black: engineColor === "black" ? selectedEngine.name : "You"
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
    onStart();
  }

  async function stop() {
    await window.chaturanga?.engines.stop();
    useAnalysisStore.getState().reset();
    game.setMode("freeplay");
    game.setEngineSide(null);
    game.clearEngineMatchExtras();
  }

  return {
    engines: engines.data ?? [],
    enginesLoading: engines.isLoading,
    hasEngines: Boolean(engines.data?.length),
    engineId: engineId || defaultEngine?.id || "",
    setEngineId,
    canStart: Boolean(selectedEngine?.isAvailable) && !onlineGameLive,
    matchRunning,
    humanColor,
    setHumanColor,
    moveTimeMs,
    setMoveTimeMs,
    depth,
    setDepth,
    clockPreset,
    setClockPreset,
    customMinutes,
    setCustomMinutes,
    customIncrementSec,
    setCustomIncrementSec,
    startGame,
    stop
  };
}

function EngineGameSetupBody({
  setup,
  onOpenSettings
}: {
  setup: EngineGameSetupState;
  onOpenSettings: () => void;
}) {
  if (setup.enginesLoading) return null;
  if (!setup.hasEngines) {
    return (
      <EmptyState
        icon={<Bot />}
        title="No engine installed"
        description="Download Stockfish or add a UCI engine in Settings."
        action={
          <Button type="button" variant="primary" onClick={onOpenSettings}>
            Open settings
          </Button>
        }
      />
    );
  }

  const timed = setup.clockPreset !== "infinite";

  return (
    <div className="grid gap-5">
      <Field label="Opponent" htmlFor="engine-game-opponent" className="max-w-xl">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <EngineDropdown
              id="engine-game-opponent"
              engines={setup.engines}
              value={setup.engineId}
              onChange={setup.setEngineId}
            />
          </div>
          <IconButton label="Engine settings" icon={<Settings />} size="icon" onClick={onOpenSettings} />
        </div>
      </Field>

      <Field label="Play as">
        <SegmentedControl
          ariaLabel="Play as"
          value={setup.humanColor}
          onChange={setup.setHumanColor}
          className="w-fit"
          options={[
            { value: "white", label: "White", icon: <SideDot color="white" /> },
            { value: "black", label: "Black", icon: <SideDot color="black" /> }
          ]}
        />
      </Field>

      <div className="grid gap-2">
        <span className={fieldLabel}>Time control</span>
        <div role="radiogroup" aria-label="Time control" className="flex flex-wrap gap-x-6 gap-y-3">
          {clockGroups.map((group) => (
            <div key={group} className="grid gap-1.5">
              <Eyebrow>{group}</Eyebrow>
              <div className="flex flex-wrap gap-1.5">
                {clockPresets
                  .filter((preset) => preset.group === group)
                  .map((preset) => (
                    <ChipButton
                      key={preset.id}
                      role="radio"
                      aria-checked={setup.clockPreset === preset.id}
                      aria-pressed={undefined}
                      selected={setup.clockPreset === preset.id}
                      className="min-w-12 justify-center"
                      onClick={() => setup.setClockPreset(preset.id)}
                    >
                      {preset.label}
                    </ChipButton>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {setup.clockPreset === "custom" ? (
        <div className="grid max-w-md grid-cols-2 gap-3">
          <Field label="Minutes per side" htmlFor="engine-game-minutes">
            <Input
              id="engine-game-minutes"
              type="number"
              min={0.5}
              step={0.5}
              value={setup.customMinutes}
              onChange={(event) => setup.setCustomMinutes(Number(event.target.value))}
            />
          </Field>
          <Field label="Increment" hint="sec" htmlFor="engine-game-increment">
            <Input
              id="engine-game-increment"
              type="number"
              min={0}
              value={setup.customIncrementSec}
              onChange={(event) => setup.setCustomIncrementSec(Number(event.target.value))}
            />
          </Field>
        </div>
      ) : null}

      {timed ? null : (
        <Disclosure
          title="Search limits"
          summary={`${setup.moveTimeMs} ms${setup.depth ? ` · depth ${setup.depth}` : ""}`}
        >
          <div className="grid max-w-md grid-cols-2 gap-3">
            <Field label="Move time" hint="ms" htmlFor="engine-game-movetime">
              <Input
                id="engine-game-movetime"
                type="number"
                min={100}
                value={setup.moveTimeMs}
                onChange={(event) => setup.setMoveTimeMs(Number(event.target.value))}
              />
            </Field>
            <Field label="Depth" hint="optional" htmlFor="engine-game-depth">
              <Input
                id="engine-game-depth"
                type="number"
                min={1}
                value={setup.depth ?? ""}
                placeholder="No cap"
                onChange={(event) => setup.setDepth(event.target.value ? Number(event.target.value) : null)}
              />
            </Field>
          </div>
        </Disclosure>
      )}
    </div>
  );
}

function EngineDropdown({
  id,
  engines,
  onChange,
  value
}: {
  id?: string;
  engines: EngineConfig[];
  onChange: (engineId: string) => void;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = engines.find((engine) => engine.id === value) ?? engines[0];

  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);

  return (
    <div ref={rootRef} className="relative">
      <button
        id={id}
        type="button"
        className={cn(settingsListboxTriggerClass, open && settingsListboxTriggerOpenRing)}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <EngineLogo engine={selected} />
          <span className="grid min-w-0">
            <span className="truncate text-sm font-medium">{selected?.name ?? "Select engine"}</span>
            {selected ? <span className="truncate text-2xs text-fg-subtle">{engineSubtitle(selected)}</span> : null}
          </span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-fg-muted transition-transform", open && "rotate-180")} />
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
                  !engine.isAvailable && "cursor-not-allowed opacity-50 hover:bg-transparent"
                )}
                onClick={() => {
                  onChange(engine.id);
                  setOpen(false);
                }}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <EngineLogo engine={engine} />
                  <span className="grid min-w-0">
                    <span className="truncate font-medium">{engine.name}</span>
                    <span className="truncate text-2xs text-fg-subtle">{engineSubtitle(engine)}</span>
                  </span>
                </span>
                {active ? <Check className="size-4 shrink-0 text-accent-fg" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function engineSubtitle(engine: EngineConfig): string {
  const source = isManagedEngine(engine) ? "Managed" : "Custom UCI";
  const status = engine.isAvailable ? (engine.isDefault ? "Default" : "Configured") : "Unavailable";
  return `${status} · ${source}`;
}

function EngineLogo({ engine }: { engine: EngineConfig | undefined }) {
  const src = localImageSrc(engine?.imagePath);
  return (
    <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-accent-soft text-accent-fg">
      {src ? <img className="h-full w-full object-cover" src={src} alt="" /> : <Bot className="size-3.5" />}
    </span>
  );
}

function SetupActions({ setup }: { setup: EngineGameSetupState }) {
  return (
    <>
      {setup.matchRunning ? (
        <Button type="button" variant="outline" onClick={() => void setup.stop()}>
          End current game
        </Button>
      ) : null}
      <Button type="button" variant="primary" disabled={!setup.canStart} onClick={setup.startGame}>
        <Play />
        Start game
      </Button>
    </>
  );
}
