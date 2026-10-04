import { memo, useCallback, useId, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  Globe,
  Play,
  Settings,
  SquareDashed,
  X
} from "lucide-react";
import { isManagedEngine } from "@chaturanga/shared/engine/managed";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import { useEnginesQuery } from "../../queries/api";
import { useAnalysisStore } from "../../stores/analysis-store";
import { useGameStore } from "../../stores/game-store";
import { selectLiveGameInProgress, useLichessStore } from "../../stores/lichess-store";
import { LichessPlayActions, LichessPlayPanel, useLichessSeekSetup } from "../lichess/LichessPlayPanel";
import type { Color } from "@chaturanga/shared/types/chess";
import { ChipButton } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Eyebrow, Page } from "@/components/ui/page";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { BoardThumbnail } from "../settings/board-thumbnail";
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
import { usePlayDraftStore, type PlayInitialSession } from "../../stores/play-draft-store";
import { useRepertoireHandoffStore } from "../../stores/repertoire-handoff-store";
import { holdUntilChanged } from "../../app/useGameAutosave";
import { ReviewBoard } from "../game-review/ReviewBoard";
import { gameFromInitialSession } from "../repertoire/handoffs";
import { Notice } from "@/components/ui/notice";
import { useListboxKeyboard } from "@/lib/use-listbox-keyboard";
import { positionStatus } from "@/lib/position-status";
import { START_FEN } from "@chaturanga/shared/chess/position";
import { createGameFromFen } from "@chaturanga/shared/chess/pgn";
import { useShallow } from "zustand/react/shallow";

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
  /** Right before the engine game replaces the board (history keeps the board being left). */
  onBeforeStart: () => void;
  onStart: () => void;
};

const opponentOptions = [
  { value: "lichess", label: "Lichess", icon: <Globe /> },
  { value: "engine", label: "Engine", icon: <Bot /> },
  { value: "board", label: "Free board", icon: <SquareDashed /> }
] as const;


/** Free board: what it is, with the starting position (opened from the header's Open board, or here). */
function FreeBoardPanel({ disabled, onOpen }: { disabled: boolean; onOpen: () => void }) {
  return (
    <section className={cn(cardPadded, "flex flex-wrap items-center gap-6")}>
      <button
        type="button"
        onClick={onOpen}
        disabled={disabled}
        aria-label="Open a free board"
        className="w-44 shrink-0 rounded-xl transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60"
      >
        <BoardThumbnail fen={START_FEN} rounded="xl" />
      </button>
      <div className="grid min-w-60 flex-1 gap-2">
        <h2 className="text-base font-semibold text-fg">Free board</h2>
        <p className="text-sm text-fg-secondary">
          Play both sides from the starting position: try an opening, test an idea, or replay a game
          move by move. No clock and no opponent.
        </p>
      </div>
    </section>
  );
}

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
  const connected = useLichessStore((state) => Boolean(state.status.account) && !state.status.tokenRejected);
  const setOpponent = useLichessStore((state) => state.setPlayOpponent);
  const opponent = chosen ?? (connected ? "lichess" : "engine");
  const onlineGameLive = useLichessStore(selectLiveGameInProgress);
  const actions =
    opponent === "lichess" ? (
      <LichessPlayActions setup={lichess} />
    ) : opponent === "board" ? (
      <Button type="button" variant="primary" disabled={onlineGameLive} onClick={props.onFreeBoard}>
        <Play />
        Open board
      </Button>
    ) : setup.hasEngines ? (
      <SetupActions setup={setup} />
    ) : null;
  return (
    <Page>
      {/* The kind of game and its start action on one row (Start is the page's primary action). */}
      <header className="flex min-h-9 flex-wrap items-center gap-3">
        <h1 className="sr-only">Play</h1>
        <SegmentedControl ariaLabel="Opponent" value={opponent} onChange={setOpponent} options={opponentOptions} className="w-fit" />
        {actions ? <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      {opponent === "lichess" ? (
        <LichessPlayPanel setup={lichess} onOpenGame={props.onOpenLichessGame} />
      ) : opponent === "engine" ? (
        <section className={cardPadded}>
          <EngineGameSetupBody setup={setup} onOpenSettings={props.onOpenSettings} />
        </section>
      ) : (
        <FreeBoardPanel disabled={onlineGameLive} onOpen={props.onFreeBoard} />
      )}
    </Page>
  );
});

type EngineGameSetupState = ReturnType<typeof useEngineGameSetup>;

function useEngineGameSetup({ onOpenSettings, onBeforeStart, onStart }: EngineGameSetupProps) {
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
  // Kept outside the page (play-draft-store): Engine settings and Back return to the same choices.
  const draft = usePlayDraftStore((state) => state.draft);
  const updateDraft = usePlayDraftStore((state) => state.update);
  // A repertoire handoff (Study → Play from here): the game starts there, as its colour.
  const initialSession = draft.initialSession ?? null;
  const [handoffError, setHandoffError] = useState<string | null>(null);
  // A chosen engine that was deleted since falls back to the default — and so does the id used.
  const selectedEngine = engines.data?.find((engine) => engine.id === draft.engineId) ?? defaultEngine;
  const engineId = selectedEngine?.id ?? "";
  const humanColor: Color = initialSession?.playerColor ?? draft.humanColor ?? game.orientation;
  const moveTimeMs = draft.moveTimeMs ?? game.moveTimeMs;
  const depth = draft.depth === undefined ? game.depth : draft.depth;
  // The draft is persisted: an id from an older build falls back to no clock.
  const clockPreset: ClockPresetId = clockPresets.find((item) => item.id === draft.clockPreset)?.id ?? "infinite";
  const { customMinutes, customIncrementSec } = draft;
  const setEngineId = (value: string) => updateDraft({ engineId: value });
  const setHumanColor = (value: Color) => updateDraft({ humanColor: value });
  const setMoveTimeMs = (value: number) => updateDraft({ moveTimeMs: value });
  const setDepth = (value: number | null) => updateDraft({ depth: value });
  const setClockPreset = (value: ClockPresetId) => updateDraft({ clockPreset: value });
  const setCustomMinutes = (value: number) => updateDraft({ customMinutes: value });
  const setCustomIncrementSec = (value: number) => updateDraft({ customIncrementSec: value });
  // The position on the board, if a game can start from it (not the start position, not over).
  const boardPosition = useGameStore(
    useShallow((state) => {
      const status = positionStatus(state.currentFen);
      return state.currentFen !== START_FEN && !status.isEnd
        ? { fen: state.currentFen, turn: status.turn, moveNumber: Number(state.currentFen.split(" ")[5]) || 1 }
        : null;
    })
  );
  const [startFrom, setStartFrom] = useState<"new" | "position">("new");
  const fromPosition =
    !initialSession && startFrom === "position" && boardPosition ? boardPosition : null;
  const shownStartFrom: "new" | "position" = fromPosition ? "position" : "new";

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
    // A Lichess game owns the board until it ends (checked here too, not only on the button).
    if (selectLiveGameInProgress(useLichessStore.getState())) return;
    const engineColor: Color = humanColor === "white" ? "black" : "white";
    const clock = resolveClockMs();
    // A repertoire handoff: its moves replayed into the new game (the position keeps its history).
    const handoffGame = initialSession ? gameFromInitialSession(initialSession, {}) : null;
    if (initialSession && !handoffGame) {
      setHandoffError(
        "This repertoire position couldn't be set up. Clear it and start a new game."
      );
      return;
    }
    setHandoffError(null);
    onBeforeStart();
    // Play from here: the game begins at the board's position (a PGN with its FEN), not move 1.
    if (handoffGame) game.loadGame(handoffGame);
    else if (fromPosition) {
      game.loadGame(createGameFromFen({ fen: fromPosition.fen, source: "engine-game" }));
    }
    else game.reset();
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
    // A value still being typed (the field not left yet) is held to the accepted range here too.
    game.setEngineLimits(clampLimit(moveTimeMs, 100, ENGINE_LIMITS.moveTimeMs), clampDepth(depth));
    game.setMatchFeedback(null);
    // The clock starts at the handoff position (after the replayed prefix), with its side to move.
    if (clock) {
      game.setEngineMatchClock(clock);
      game.initEngineClockLive();
    } else {
      game.setEngineMatchClock(null);
    }
    if (initialSession && handoffGame) {
      // Not in the library until a move is played; then linked to the repertoire as a played game.
      holdUntilChanged();
      useRepertoireHandoffStore.getState().begin({
        ...initialSession.repertoire,
        gameNodeId: handoffGame.currentNodeId,
        color: initialSession.playerColor,
        board: useGameStore.getState().board
      });
      // The choices from before the handoff come back for the next game (see withoutInitialSession).
      usePlayDraftStore.getState().clearInitialSession();
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
    boardPosition: initialSession ? null : boardPosition,
    initialSession,
    clearInitialSession: () => {
      setHandoffError(null);
      usePlayDraftStore.getState().clearInitialSession();
    },
    handoffError,
    startFrom: shownStartFrom,
    setStartFrom,
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
  const startingFrom = setup.initialSession ? (
    <StartingFromCard
      initial={setup.initialSession}
      onClear={setup.clearInitialSession}
      error={setup.handoffError}
    />
  ) : null;
  if (!setup.hasEngines) {
    // The handoff stays in the draft while engines are set up (Settings, then Back here).
    return (
      <div className="grid gap-5">
        {startingFrom}
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
      </div>
    );
  }

  const timed = setup.clockPreset !== "infinite";

  return (
    <div className="grid gap-5">
      {startingFrom}
      {setup.boardPosition ? (
        <Field label="Start from">
          <SegmentedControl
            ariaLabel="Start from"
            value={setup.startFrom}
            onChange={(value) => setup.setStartFrom(value)}
            options={[
              { value: "new", label: "New game" },
              {
                value: "position",
                label: `This position (move ${setup.boardPosition.moveNumber}, ${setup.boardPosition.turn === "white" ? "White" : "Black"} to move)`
              }
            ]}
          />
        </Field>
      ) : null}
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

      <Field label="Play as" hint={setup.initialSession ? "your repertoire's side" : undefined}>
        <SegmentedControl
          ariaLabel="Play as"
          value={setup.humanColor}
          onChange={setup.setHumanColor}
          className="w-fit"
          options={[
            {
              value: "white",
              label: "White",
              icon: <SideDot color="white" />,
              disabled: Boolean(setup.initialSession)
            },
            {
              value: "black",
              label: "Black",
              icon: <SideDot color="black" />,
              disabled: Boolean(setup.initialSession)
            }
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
                max={ENGINE_LIMITS.moveTimeMs}
                value={setup.moveTimeMs}
                // Typed freely; held to the accepted range when the field is left (and at Start).
                onChange={(event) => setup.setMoveTimeMs(Number(event.target.value))}
                onBlur={() => setup.setMoveTimeMs(clampLimit(setup.moveTimeMs, 100, ENGINE_LIMITS.moveTimeMs))}
              />
            </Field>
            <Field label="Depth" hint="optional" htmlFor="engine-game-depth">
              <Input
                id="engine-game-depth"
                type="number"
                min={1}
                max={ENGINE_LIMITS.depth}
                value={setup.depth ?? ""}
                placeholder="No cap"
                onChange={(event) => setup.setDepth(event.target.value ? Number(event.target.value) : null)}
                onBlur={() => setup.setDepth(clampDepth(setup.depth))}
              />
            </Field>
          </div>
        </Disclosure>
      )}
    </div>
  );
}

/** The search limits the main process accepts (validate.ts SEARCH_LIMITS). */
const ENGINE_LIMITS = { moveTimeMs: 3_600_000, depth: 200 } as const;

function clampLimit(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

function clampDepth(depth: number | null): number | null {
  return depth === null ? null : Math.round(clampLimit(depth, 1, ENGINE_LIMITS.depth));
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
  const fallbackId = useId();
  const listId = id ?? fallbackId;
  const { triggerRef, highlightedIndex, setHighlightedIndex, optionId, commit, onTriggerKeyDown } = useListboxKeyboard({
    id: listId,
    count: engines.length,
    selectedIndex: engines.findIndex((engine) => engine.id === selected?.id),
    isDisabled: (index) => !engines[index]?.isAvailable,
    open,
    setOpen,
    onCommit: (index) => {
      const engine = engines[index];
      if (engine) onChange(engine.id);
    }
  });

  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={cn(settingsListboxTriggerClass, open && settingsListboxTriggerOpenRing)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? `${listId}-listbox` : undefined}
        aria-activedescendant={open ? optionId(highlightedIndex) : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={onTriggerKeyDown}
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
        <div id={`${listId}-listbox`} className={cn(settingsListboxPopoverClass, "left-0 right-0")} role="listbox">
          {engines.map((engine, index) => {
            const active = engine.id === selected?.id;
            const highlighted = index === highlightedIndex;
            return (
              <button
                key={engine.id}
                id={optionId(index)}
                type="button"
                role="option"
                aria-selected={active}
                aria-disabled={!engine.isAvailable || undefined}
                tabIndex={-1}
                disabled={!engine.isAvailable}
                className={cn(
                  settingsListboxOptionClass,
                  active && settingsListboxOptionActiveClass,
                  highlighted && !active && "bg-control",
                  !engine.isAvailable && "cursor-not-allowed opacity-50 hover:bg-transparent"
                )}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => commit(index)}
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

/**
 * The repertoire position an engine game will start from (Study → Play from here): a small board,
 * its name and route, and Clear to start a normal game instead.
 */
function StartingFromCard({
  initial,
  onClear,
  error
}: {
  initial: PlayInitialSession;
  onClear: () => void;
  error: string | null;
}) {
  const fen = useMemo(
    () => gameFromInitialSession(initial, {})?.currentFen ?? initial.rootFen,
    [initial]
  );
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line p-3">
        <div className="aspect-square w-28 shrink-0 overflow-hidden rounded-lg">
          <ReviewBoard fen={fen} orientation={initial.playerColor} className="h-full w-full" />
        </div>
        <div className="grid min-w-48 flex-1 gap-1">
          <Eyebrow className="flex items-center gap-1.5">
            <BookOpen className="size-3.5" />
            Starting from
          </Eyebrow>
          <p className="text-sm font-medium text-fg">{initial.label}</p>
          <p className="text-xs text-fg-muted">
            You play {initial.playerColor === "white" ? "White" : "Black"}. The game is saved to
            your library; it never changes the repertoire.
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          <X />
          Clear
        </Button>
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </div>
  );
}
