/**
 * What the Play card shows for each opponent (PlayCard.tsx lays it out): the You-vs-opponent
 * header, the controls, the footer's button, and the preview board's position.
 */
import { useId, type ReactNode } from "react";
import { BookOpen, Bot, Globe, InfinityIcon, Play, Send, UserPlus, X } from "lucide-react";
import { engineDisplayName } from "@chaturanga/shared/engine/managed";
import { START_FEN } from "@chaturanga/shared/chess/position";
import type { Color } from "@chaturanga/shared/types/chess";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import {
  CHALLENGE_PRESETS,
  SEEK_PRESETS,
  presetLabel,
  type LichessClockPreset
} from "../lichess/lichess-game";
import type {
  ColorChoice,
  useAiChallenge,
  useFriendChallenge,
  useLichessSeekSetup
} from "../lichess/use-lichess-play";
import { BoardThumbnail } from "../settings/board-thumbnail";
import { CustomClockSteppers, TimeControlSlider, type SliderStop } from "./TimeControlSlider";
import {
  KingTile,
  MatchSide,
  NoOpponentSide,
  OpponentTile,
  WaitBar,
  footButton,
  playSegAccentClass,
  playSegClass
} from "./play-card-parts";
import { PiecePair } from "./piece-art";
import { ENGINE_CLOCK_PRESETS, clockText, engineClockText, presetIndex } from "./time-control";
import type { EngineGameSetup } from "./use-engine-game-setup";

const RATED_OPTIONS = [
  { value: "rated", label: "Rated" },
  { value: "casual", label: "Casual" }
] as const;

const AI_LEVELS = ["1", "2", "3", "4", "5", "6", "7", "8"].map((level) => ({
  value: level,
  label: level
}));

const FRIEND_SWAP: Record<ColorChoice, ColorChoice> = {
  random: "white",
  white: "black",
  black: "random"
};

/** What the card shows for its opponent: the header, the controls, the footer. */
export type CardView = {
  header: {
    you: ReactNode;
    opponent: ReactNode;
    onSwap: (() => void) | null;
    swapDisabled?: boolean;
    bare: boolean;
  } | null;
  body: ReactNode;
  /** The body takes the card's spare height (Free board's illustration). */
  bodyFills?: boolean;
  foot: ReactNode;
  error: string | null;
  orientation: Color;
  previewFen: string;
};

/** No engine and no Lichess account yet: the two ways to get an opponent. */
export function firstRunView(ways: ReactNode): CardView {
  return {
    header: {
      you: <MatchSide tile={<KingTile color="white" />} name="You" detail="" />,
      opponent: <NoOpponentSide />,
      onSwap: null,
      bare: false
    },
    body: <div className="grid gap-2.5">{ways}</div>,
    foot: null,
    error: null,
    orientation: "white",
    previewFen: START_FEN
  };
}

/** Free board: both sides from the starting position, no clock and no opponent. */
export function boardView(onFreeBoard: () => void): CardView {
  return {
    header: null,
    body: (
      <div className="flex flex-1 flex-col items-center justify-center gap-3.5 text-center">
        <PiecePair piece="knight" pieceClassName="size-29" gapClassName="gap-1.5" />
        <p className="m-0 max-w-[40ch] text-[0.8125rem] leading-[1.55] text-fg-muted">
          Play both sides from the starting position: try an opening, test an idea, or replay a game
          move by move. No clock and no opponent.
        </p>
      </div>
    ),
    bodyFills: true,
    foot: (
      <Button type="button" variant="primary" className={footButton} onClick={onFreeBoard}>
        <Play />
        Open board
      </Button>
    ),
    error: null,
    orientation: "white",
    previewFen: START_FEN
  };
}

/* ------------------------------------------------------------------ Lichess opponents */

/**
 * What every Lichess opponent's view shares: until an account is connected (`locked`) the way to
 * connect one takes the controls' place, with no button or error under it.
 */
export type LichessContext = { locked: boolean; onlineWay: ReactNode; apiAvailable: boolean };

/** You, with your Lichess rating at the time control once connected. */
function LichessYou({
  color,
  rating,
  locked
}: {
  color: ColorChoice;
  rating: number | null;
  locked: boolean;
}) {
  return (
    <MatchSide tile={<KingTile color={color} />} name="You" detail={locked ? "" : (rating ?? "")} />
  );
}

/** Quick pairing: a seek in Lichess's pool at a time control, rated or casual. */
export function poolView(
  {
    seek,
    rating,
    seconds
  }: { seek: ReturnType<typeof useLichessSeekSetup>; rating: number | null; seconds: number },
  lichess: LichessContext
): CardView {
  const { locked } = lichess;
  return {
    header: {
      you: <LichessYou color="random" rating={rating} locked={locked} />,
      opponent: (
        <MatchSide
          tile={<OpponentTile kind="online" icon={<Globe aria-hidden="true" />} />}
          name="Quick pairing"
          detail=""
        />
      ),
      onSwap: null,
      bare: false
    },
    body: locked ? (
      lichess.onlineWay
    ) : (
      <>
        <TimeControlSlider
          stops={lichessStops(SEEK_PRESETS)}
          value={presetIndex(SEEK_PRESETS, seek.preset)}
          onChange={(next) => seek.setPreset(SEEK_PRESETS[next] ?? SEEK_PRESETS[0])}
        />
        <RatedChoice rated={seek.rated} onChange={seek.setRated} />
      </>
    ),
    foot: locked ? null : seek.seek ? (
      <WaitBar label="Finding an opponent…" seconds={seconds} onCancel={seek.cancel} />
    ) : (
      <Button
        type="button"
        variant="primary"
        className={footButton}
        disabled={!lichess.apiAvailable}
        onClick={seek.start}
      >
        <Play />
        Play {presetLabel(seek.preset)}
      </Button>
    ),
    error: locked ? null : seek.error,
    orientation: "white",
    previewFen: START_FEN
  };
}

/** Challenge a friend: their username in the opponent's place, a time control, rated or casual. */
export function friendView(
  {
    friend,
    rating,
    seconds
  }: { friend: ReturnType<typeof useFriendChallenge>; rating: number | null; seconds: number },
  lichess: LichessContext
): CardView {
  const { locked } = lichess;
  return {
    header: {
      you: <LichessYou color={friend.color} rating={rating} locked={locked} />,
      opponent: (
        <MatchSide
          tile={<OpponentTile kind="online" icon={<UserPlus aria-hidden="true" />} />}
          name={
            locked ? (
              "Challenge a friend"
            ) : (
              <FriendField
                value={friend.username}
                onChange={friend.setUsername}
                onSubmit={friend.send}
              />
            )
          }
        />
      ),
      onSwap: () => friend.setColor(FRIEND_SWAP[friend.color]),
      bare: false
    },
    body: locked ? (
      lichess.onlineWay
    ) : (
      <>
        <TimeControlSlider
          stops={lichessStops(CHALLENGE_PRESETS)}
          value={presetIndex(CHALLENGE_PRESETS, friend.preset)}
          onChange={(next) => friend.setPreset(CHALLENGE_PRESETS[next] ?? CHALLENGE_PRESETS[0])}
        />
        <RatedChoice rated={friend.rated} onChange={friend.setRated} />
      </>
    ),
    foot: locked ? null : friend.waiting ? (
      <WaitBar
        label={`Waiting for ${friend.waiting.name}…`}
        seconds={seconds}
        onCancel={friend.cancelWaiting}
      />
    ) : (
      <Button
        type="button"
        variant="primary"
        className={footButton}
        disabled={!lichess.apiAvailable || friend.busy || !friend.username.trim()}
        onClick={friend.send}
      >
        <Send />
        Send challenge
      </Button>
    ),
    error: locked ? null : friend.error,
    orientation: friend.color === "black" ? "black" : "white",
    previewFen: START_FEN
  };
}

/** The Lichess AI: its level and a time control, you on the colour picked. */
export function aiView(
  { ai, rating }: { ai: ReturnType<typeof useAiChallenge>; rating: number | null },
  lichess: LichessContext
): CardView {
  const { locked } = lichess;
  return {
    header: {
      you: <LichessYou color={ai.color} rating={rating} locked={locked} />,
      opponent: (
        <MatchSide
          tile={
            <OpponentTile
              kind="online"
              icon={<Bot aria-hidden="true" />}
              side={ai.color === "white" ? "black" : "white"}
            />
          }
          name="Play the Lichess AI"
          detail=""
        />
      ),
      onSwap: () => ai.setColor(ai.color === "white" ? "black" : "white"),
      bare: false
    },
    body: locked ? (
      lichess.onlineWay
    ) : (
      <>
        <AiLevel level={ai.level} onChange={ai.setLevel} />
        <TimeControlSlider
          stops={lichessStops(CHALLENGE_PRESETS)}
          value={presetIndex(CHALLENGE_PRESETS, ai.preset)}
          onChange={(next) => ai.setPreset(CHALLENGE_PRESETS[next] ?? CHALLENGE_PRESETS[0])}
        />
      </>
    ),
    foot: locked ? null : (
      <Button
        type="button"
        variant="primary"
        className={footButton}
        disabled={!lichess.apiAvailable || ai.busy}
        onClick={ai.start}
      >
        <Play />
        Play
      </Button>
    ),
    error: locked ? null : ai.error,
    orientation: ai.color,
    previewFen: START_FEN
  };
}

/* ------------------------------------------------------------------ engine */

export function engineView({
  engine,
  handoffFen,
  handoffStrip,
  enginesWay
}: {
  engine: EngineGameSetup;
  handoffFen: string | null;
  handoffStrip: ReactNode;
  enginesWay: ReactNode;
}): CardView {
  const you = <MatchSide tile={<KingTile color={engine.humanColor} />} name="You" />;
  // No engine yet: the way to get one, in place of the clock and the button.
  if (engine.enginesLoaded && !engine.engines.length) {
    return {
      header: {
        you: <MatchSide tile={<KingTile color={engine.humanColor} />} name="You" detail="" />,
        opponent: <NoOpponentSide />,
        onSwap: null,
        bare: false
      },
      body: (
        <div className="grid gap-2.5">
          {handoffStrip}
          {enginesWay}
        </div>
      ),
      foot: null,
      error: engine.handoffError,
      orientation: engine.humanColor,
      previewFen: handoffFen ?? START_FEN
    };
  }
  const selected = engine.selectedEngine;
  const engineSide: Color = engine.humanColor === "white" ? "black" : "white";
  const index = Math.max(
    0,
    ENGINE_CLOCK_PRESETS.findIndex((preset) => preset.id === engine.clockPreset)
  );
  const stops: SliderStop[] = ENGINE_CLOCK_PRESETS.map((preset) => ({
    key: preset.id,
    label:
      preset.id === "infinite" ? (
        <InfinityIcon aria-hidden="true" />
      ) : preset.id === "custom" ? (
        <ClockEditIcon />
      ) : preset.clock ? (
        presetLabel(preset.clock)
      ) : (
        ""
      ),
    text: engineClockText(preset.id, engine.custom)
  }));
  const position = engine.boardPosition;
  return {
    header: {
      you,
      opponent: (
        <MatchSide
          tile={<OpponentTile kind="engine" engine={selected} side={engineSide} />}
          name={selected ? engineDisplayName(selected.name) : "Engine"}
        />
      ),
      onSwap: engine.swapColor,
      // A repertoire handoff plays its own colour.
      swapDisabled: Boolean(engine.initialSession),
      bare: true
    },
    body: (
      <>
        {handoffStrip}
        {position ? (
          <SegmentedControl
            ariaLabel="Start from"
            size="sm"
            fullWidth
            className={playSegClass}
            value={engine.startFrom}
            onChange={engine.setStartFrom}
            options={[
              { value: "new", label: "New game" },
              {
                value: "position",
                label: "This position",
                hint: `Move ${position.moveNumber} · ${position.turn === "white" ? "White" : "Black"} to move`
              }
            ]}
          />
        ) : null}
        <TimeControlSlider
          stops={stops}
          value={index}
          onChange={(next) => {
            const preset = ENGINE_CLOCK_PRESETS.at(next);
            if (preset) engine.setClockPreset(preset.id);
          }}
        >
          {engine.clockPreset === "custom" ? (
            <CustomClockSteppers
              minutes={engine.custom.minutes}
              incrementSec={engine.custom.incrementSec}
              onMinutes={engine.setCustomMinutes}
              onIncrement={engine.setCustomIncrementSec}
            />
          ) : null}
        </TimeControlSlider>
      </>
    ),
    foot: (
      <Button
        type="button"
        variant="primary"
        className={footButton}
        disabled={!engine.canStart}
        title={
          selected && !selected.isAvailable
            ? "This engine can’t run. Check Engine settings."
            : undefined
        }
        onClick={engine.startGame}
      >
        <Play />
        Start game
      </Button>
    ),
    error: engine.handoffError,
    orientation: engine.humanColor,
    previewFen:
      handoffFen ?? (engine.startFrom === "position" && position ? position.fen : START_FEN)
  };
}

/** Study → Play from here: where the game will start, with Clear for a normal game instead. */
export function HandoffStrip({
  fen,
  color,
  label,
  onClear
}: {
  fen: string;
  color: Color;
  label: string;
  onClear: () => void;
}) {
  return (
    <div className="flex h-10 min-w-0 items-center gap-2.5 rounded-lg border border-line bg-surface-sunken pl-1.5 pr-1">
      <BoardThumbnail fen={fen} orientation={color} rounded="md" className="w-7 shrink-0" />
      <BookOpen className="size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-xs text-fg-secondary" title={label}>
        {label}
      </span>
      <Button type="button" variant="ghost" size="xs" onClick={onClear}>
        <X />
        Clear
      </Button>
    </div>
  );
}

/** The clock-with-a-pencil mark for Custom (the mock's own drawing). */
function ClockEditIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12.5 19.8A8.5 8.5 0 1 1 19.8 12" />
      <path d="M11 7v4.5l3 1.8" />
      <path d="m19.2 14.8 2 2-4.6 4.6H14.6v-2z" />
    </svg>
  );
}

/* ------------------------------------------------------------------ Lichess */

function lichessStops(presets: readonly LichessClockPreset[]): SliderStop[] {
  return presets.map((preset) => ({
    key: presetLabel(preset),
    label: presetLabel(preset),
    text: clockText(preset)
  }));
}

function RatedChoice({ rated, onChange }: { rated: boolean; onChange: (rated: boolean) => void }) {
  return (
    <SegmentedControl
      ariaLabel="Rated or casual"
      size="sm"
      fullWidth
      className={playSegClass}
      value={rated ? "rated" : "casual"}
      onChange={(value) => onChange(value === "rated")}
      options={RATED_OPTIONS}
    />
  );
}

function AiLevel({ level, onChange }: { level: number; onChange: (level: number) => void }) {
  const labelId = useId();
  return (
    <div className="grid gap-2" aria-labelledby={labelId} role="group">
      <span id={labelId} className="text-xs font-medium text-fg-muted">
        Level
      </span>
      <SegmentedControl
        ariaLabel="Lichess AI level"
        size="sm"
        fullWidth
        className={cn(playSegClass, playSegAccentClass)}
        value={String(level)}
        onChange={(value) => onChange(Number(value))}
        options={AI_LEVELS}
      />
    </div>
  );
}

/** Challenge a friend: their username, typed where their name will show (Enter sends). */
function FriendField({
  value,
  onChange,
  onSubmit
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <label className="mt-2 block w-full max-w-42">
      <span className="sr-only">Lichess username</span>
      <input
        type="text"
        value={value}
        placeholder="Friend’s username"
        spellCheck={false}
        autoComplete="off"
        className="h-8 w-full rounded-lg border border-line-strong bg-surface-sunken px-2.5 text-center text-[0.84375rem] font-medium text-fg outline-none transition-[border-color,box-shadow] duration-micro placeholder:font-normal placeholder:text-fg-subtle focus:border-accent focus:ring-[3px] focus:ring-accent/20"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onSubmit();
        }}
      />
    </label>
  );
}
