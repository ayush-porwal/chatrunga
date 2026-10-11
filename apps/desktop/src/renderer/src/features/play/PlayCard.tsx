import { memo, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BookOpen,
  Bot,
  Download,
  Globe,
  InfinityIcon,
  Loader2,
  Play,
  RefreshCw,
  Send,
  Settings,
  UserPlus,
  X
} from "lucide-react";
import { engineDisplayName } from "@chaturanga/shared/engine/managed";
import { START_FEN } from "@chaturanga/shared/chess/position";
import type { Color } from "@chaturanga/shared/types/chess";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Progress } from "@/components/ui/progress";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { localImageSrc } from "@/lib/local-image";
import { cn } from "@/lib/utils";
import { useSettingsQuery, useUpdateSettingsMutation } from "../../queries/api";
import { selectLiveGameInProgress, useLichessStore } from "../../stores/lichess-store";
import { useLichessConnect } from "../lichess/LichessAccount";
import {
  CHALLENGE_PRESETS,
  SEEK_PRESETS,
  presetLabel,
  type LichessClockPreset
} from "../lichess/lichess-game";
import {
  useAiChallenge,
  useElapsedSeconds,
  useFriendChallenge,
  useLichessRating,
  useLichessSeekSetup,
  type ColorChoice
} from "../lichess/use-lichess-play";
import { useEngineSetup } from "../onboarding/useEngineSetup";
import { gameFromInitialSession } from "../repertoire/handoffs";
import { BoardThumbnail } from "../settings/board-thumbnail";
import { PlaySettingsDialog } from "./PlaySettingsDialog";
import { CustomClockSteppers, TimeControlSlider, type SliderStop } from "./TimeControlSlider";
import {
  ErrorLine,
  KingTile,
  LiveGameNote,
  MatchSide,
  Matchup,
  NoOpponentSide,
  OpponentTile,
  WaitBar,
  WayRow,
  footButton,
  playSegAccentClass,
  playSegClass,
  wayButton
} from "./play-card-parts";
import { WIDE_GAP, resolvePlayMode, savePlaySettings } from "./play-layout";
import { useWidePreviewSize } from "./use-wide-preview-size";
import { PiecePair } from "./piece-art";
import { ENGINE_CLOCK_PRESETS, clockText, engineClockText, presetIndex } from "./time-control";
import { useEngineGameSetup, type EngineGameSetup } from "./use-engine-game-setup";

const cardShell = "min-w-0 rounded-xl border border-line bg-surface leading-[1.43]";

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

export type PlayCardProps = {
  /** Columns the card spans; two or more: wide, with the preview board on the left. */
  span: 1 | 2 | 3;
  /** No engine and no Lichess account yet: the two ways to get an opponent. */
  firstRun: boolean;
  desktopApiAvailable: boolean;
  onOpenEngineSettings: () => void;
  onBeforeEngineGame: () => void;
  onEngineGameStarted: () => void;
  onFreeBoard: () => void;
};

/** What the card shows for its opponent: the header, the controls, the footer. */
type CardView = {
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

/**
 * Play: you against the opponent chosen in Play settings (an engine, Quick pairing, a friend, the
 * Lichess AI, or a free board), its time control and options, and the button that starts the game.
 * The You-vs-opponent header takes whatever height the controls leave, so the card keeps the
 * row's height. Wide, a preview board sits on the left.
 */
export const PlayCard = memo(function PlayCard({
  span,
  firstRun,
  desktopApiAvailable,
  onOpenEngineSettings,
  onBeforeEngineGame,
  onEngineGameStarted,
  onFreeBoard
}: PlayCardProps) {
  const wide = span > 1;
  const wideBodyRef = useRef<HTMLDivElement | null>(null);
  const boardSize = useWidePreviewSize(wideBodyRef, wide);
  const settings = useSettingsQuery();
  const status = useLichessStore((state) => state.status);
  const session = useLichessStore((state) => state.playOpponent);
  const liveGame = useLichessStore(selectLiveGameInProgress);
  const account = status.account;
  const connected = Boolean(account) && !status.tokenRejected;
  const mode = resolvePlayMode({
    session,
    saved: settings.data?.playOpponent ?? null,
    hasAccount: Boolean(account),
    connected
  });

  const engine = useEngineGameSetup({
    onBeforeStart: onBeforeEngineGame,
    onStart: onEngineGameStarted
  });
  const seek = useLichessSeekSetup();
  const friend = useFriendChallenge();
  const ai = useAiChallenge();
  const poolRating = useLichessRating(seek.preset);
  const friendRating = useLichessRating(friend.preset);
  const aiRating = useLichessRating(ai.preset);
  const rapidRating = account?.perfs.rapid?.rating ?? null;
  const seekSeconds = useElapsedSeconds(seek.seek?.startedAt ?? null);
  const waitSeconds = useElapsedSeconds(friend.waiting?.since ?? null);
  const connect = useLichessConnect();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const updateSettings = useUpdateSettingsMutation();
  const handoffFen = useMemo(() => {
    const initial = engine.initialSession;
    return initial ? (gameFromInitialSession(initial, {})?.currentFen ?? initial.rootFen) : null;
  }, [engine.initialSession]);

  const onlineWay = (
    <OnlineWay reconnect={Boolean(account)} connect={connect} disabled={!desktopApiAvailable} />
  );
  const enginesWay = (
    <EnginesWay disabled={!desktopApiAvailable} onOpenEngineSettings={onOpenEngineSettings} />
  );
  const lichessLocked = !connected;
  // A repertoire handoff (Play from here) stays in view while an opponent is set up, too.
  const handoffStrip = engine.initialSession ? (
    <HandoffStrip
      fen={handoffFen ?? engine.initialSession.rootFen}
      color={engine.initialSession.playerColor}
      label={engine.initialSession.label}
      onClear={engine.clearInitialSession}
    />
  ) : null;

  let view: CardView;
  if (firstRun) {
    view = {
      header: {
        you: <MatchSide tile={<KingTile color="white" />} name="You" detail="" />,
        opponent: <NoOpponentSide />,
        onSwap: null,
        bare: false
      },
      body: (
        <div className="grid gap-2.5">
          {handoffStrip}
          {enginesWay}
          {onlineWay}
        </div>
      ),
      foot: null,
      error: null,
      orientation: "white",
      previewFen: START_FEN
    };
  } else if (mode === "engine") {
    view = engineView({ engine, handoffFen, handoffStrip, enginesWay });
  } else if (mode === "pool") {
    const index = presetIndex(SEEK_PRESETS, seek.preset);
    view = {
      header: {
        you: (
          <MatchSide
            tile={<KingTile color="random" />}
            name="You"
            detail={connected ? (poolRating ?? "") : ""}
          />
        ),
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
      body: lichessLocked ? (
        onlineWay
      ) : (
        <>
          <TimeControlSlider
            stops={lichessStops(SEEK_PRESETS)}
            value={index}
            onChange={(next) => seek.setPreset(SEEK_PRESETS[next] ?? SEEK_PRESETS[0])}
          />
          <RatedChoice rated={seek.rated} onChange={seek.setRated} />
        </>
      ),
      foot: lichessLocked ? null : seek.seek ? (
        <WaitBar label="Finding an opponent…" seconds={seekSeconds} onCancel={seek.cancel} />
      ) : (
        <Button
          type="button"
          variant="primary"
          className={footButton}
          disabled={!desktopApiAvailable}
          onClick={seek.start}
        >
          <Play />
          Play {presetLabel(seek.preset)}
        </Button>
      ),
      error: lichessLocked ? null : seek.error,
      orientation: "white",
      previewFen: START_FEN
    };
  } else if (mode === "friend") {
    const index = presetIndex(CHALLENGE_PRESETS, friend.preset);
    view = {
      header: {
        you: (
          <MatchSide
            tile={<KingTile color={friend.color} />}
            name="You"
            detail={connected ? (friendRating ?? "") : ""}
          />
        ),
        opponent: (
          <MatchSide
            tile={<OpponentTile kind="online" icon={<UserPlus aria-hidden="true" />} />}
            name={
              lichessLocked ? (
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
      body: lichessLocked ? (
        onlineWay
      ) : (
        <>
          <TimeControlSlider
            stops={lichessStops(CHALLENGE_PRESETS)}
            value={index}
            onChange={(next) => friend.setPreset(CHALLENGE_PRESETS[next] ?? CHALLENGE_PRESETS[0])}
          />
          <RatedChoice rated={friend.rated} onChange={friend.setRated} />
        </>
      ),
      foot: lichessLocked ? null : friend.waiting ? (
        <WaitBar
          label={`Waiting for ${friend.waiting.name}…`}
          seconds={waitSeconds}
          onCancel={friend.cancelWaiting}
        />
      ) : (
        <Button
          type="button"
          variant="primary"
          className={footButton}
          disabled={!desktopApiAvailable || friend.busy || !friend.username.trim()}
          onClick={friend.send}
        >
          <Send />
          Send challenge
        </Button>
      ),
      error: lichessLocked ? null : friend.error,
      orientation: friend.color === "black" ? "black" : "white",
      previewFen: START_FEN
    };
  } else if (mode === "ai") {
    const index = presetIndex(CHALLENGE_PRESETS, ai.preset);
    view = {
      header: {
        you: (
          <MatchSide
            tile={<KingTile color={ai.color} />}
            name="You"
            detail={connected ? (aiRating ?? "") : ""}
          />
        ),
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
      body: lichessLocked ? (
        onlineWay
      ) : (
        <>
          <AiLevel level={ai.level} onChange={ai.setLevel} />
          <TimeControlSlider
            stops={lichessStops(CHALLENGE_PRESETS)}
            value={index}
            onChange={(next) => ai.setPreset(CHALLENGE_PRESETS[next] ?? CHALLENGE_PRESETS[0])}
          />
        </>
      ),
      foot: lichessLocked ? null : (
        <Button
          type="button"
          variant="primary"
          className={footButton}
          disabled={!desktopApiAvailable || ai.busy}
          onClick={ai.start}
        >
          <Play />
          Play
        </Button>
      ),
      error: lichessLocked ? null : ai.error,
      orientation: ai.color,
      previewFen: START_FEN
    };
  } else {
    view = {
      header: null,
      body: (
        <div className="flex flex-1 flex-col items-center justify-center gap-3.5 text-center">
          <PiecePair piece="knight" pieceClassName="size-29" gapClassName="gap-1.5" />
          <p className="m-0 max-w-[40ch] text-[0.8125rem] leading-[1.55] text-fg-muted">
            Play both sides from the starting position: try an opening, test an idea, or replay a
            game move by move. No clock and no opponent.
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

  // A Lichess game owns the board: the setup stays in view, dimmed, and the footer says why.
  const locked = liveGame && !firstRun;
  const foot = locked ? <LiveGameNote /> : view.foot;
  const error = locked ? null : view.error;
  const header = view.header ? (
    <Matchup
      you={view.header.you}
      opponent={view.header.opponent}
      onSwap={view.header.onSwap}
      swapDisabled={view.header.swapDisabled}
      bare={view.header.bare}
      locked={locked}
    />
  ) : null;
  const body = view.body ? (
    <div
      className={cn(
        view.bodyFills ? "flex flex-1 flex-col" : "grid content-start gap-4",
        !wide && "p-4",
        locked && "pointer-events-none opacity-40"
      )}
      inert={locked}
    >
      {view.body}
    </div>
  ) : null;
  const footer =
    foot || error ? (
      <div className={cn("grid gap-2", !wide && "mt-auto px-3 pb-3")}>
        {error ? <ErrorLine>{error}</ErrorLine> : null}
        {foot}
      </div>
    ) : null;
  const gear = (
    <IconButton
      label="Play settings"
      icon={<Settings />}
      className="absolute right-2 top-2 z-[2] size-7.5 rounded-[7px] text-fg-muted"
      onClick={() => setSettingsOpen(true)}
    />
  );

  return (
    <section
      aria-label="Play"
      className={cn(cardShell, "play-card relative flex flex-col")}
      style={wide ? { gridColumn: `span ${span}` } : undefined}
    >
      {gear}
      {wide ? (
        <div
          ref={wideBodyRef}
          // At least the mock's 300px board tall; the board itself never sets the height (it is
          // sized to the body), so the row can shrink back when the window does.
          className="grid min-h-[324px] flex-1 py-3 pl-3 pr-4"
          style={{
            columnGap: WIDE_GAP,
            gridTemplateColumns: boardSize
              ? `${boardSize}px minmax(0, 1fr)`
              : "minmax(0, 47.7%) minmax(0, 1fr)"
          }}
        >
          <div className="relative min-h-0">
            <div
              className="absolute inset-y-0 left-0 grid content-center"
              style={{ width: boardSize ?? "100%" }}
            >
              <BoardThumbnail
                fen={view.previewFen}
                orientation={view.orientation}
                rounded="md"
                label={
                  view.previewFen === START_FEN
                    ? "The starting position"
                    : "The position the game starts from"
                }
              />
            </div>
          </div>
          <div className="flex min-h-0 min-w-0 flex-col gap-4">
            {header}
            {body}
            {footer}
          </div>
        </div>
      ) : (
        <>
          {header}
          {body}
          {footer ?? <div className="mt-auto pb-3" />}
        </>
      )}
      {settingsOpen ? (
        <PlaySettingsDialog
          mode={mode}
          engines={engine.engines}
          engineId={engine.selectedEngine?.id ?? null}
          lichess={
            connected && account ? { username: account.username, rating: rapidRating } : null
          }
          onConnectLichess={desktopApiAvailable ? connect.connect : null}
          onOpenEngineSettings={onOpenEngineSettings}
          onClose={() => setSettingsOpen(false)}
          onSave={(choice) => {
            setSettingsOpen(false);
            savePlaySettings(choice, useLichessStore.getState, updateSettings.mutate);
          }}
        />
      ) : null}
    </section>
  );
});

/* ------------------------------------------------------------------ engine */

function engineView({
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
          tile={
            <OpponentTile
              kind="engine"
              icon={<Bot aria-hidden="true" />}
              imageSrc={localImageSrc(selected?.imagePath)}
              side={engineSide}
            />
          }
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
            const preset = ENGINE_CLOCK_PRESETS[next];
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
function HandoffStrip({
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

/* ------------------------------------------------------------------ ways to play */

/**
 * Engines: Download engines (the downloads onboarding starts), their progress while they run,
 * Retry when one failed; without anything to download, Engine settings to add one.
 */
function EnginesWay({
  disabled,
  onOpenEngineSettings
}: {
  disabled: boolean;
  onOpenEngineSettings: () => void;
}) {
  const setup = useEngineSetup();
  const failed = setup.rows.find((row) => row.status === "error");
  let detail: ReactNode = null;
  let action: ReactNode;
  if (setup.phase === "downloading") {
    detail =
      setup.stockfishPercent !== null
        ? `Downloading Stockfish ${setup.stockfishPercent}%`
        : "Installing Stockfish…";
    action = (
      <span className="w-37.5 shrink-0" role="status">
        <Progress value={setup.stockfishPercent} aria-label="Stockfish download" />
      </span>
    );
  } else if (failed) {
    detail = <span className="text-danger">{failed.label} didn’t download.</span>;
    action = (
      <Button
        type="button"
        variant="primary"
        size="sm"
        className={wayButton}
        disabled={disabled}
        onClick={() => setup.retry(failed)}
      >
        <RefreshCw />
        Retry
      </Button>
    );
  } else {
    action = (
      <Button
        type="button"
        variant="primary"
        size="sm"
        className={wayButton}
        disabled={disabled}
        onClick={setup.offer ? setup.start : onOpenEngineSettings}
      >
        <Download />
        Download engines
      </Button>
    );
  }
  return (
    <WayRow
      piece={{ color: "black", role: "queen" }}
      square="dark"
      badge={<Download />}
      badgeBob={setup.phase !== "downloading"}
      title="Engines"
      detail={detail}
      action={action}
    />
  );
}

/** Online: Connect (or Reconnect) Lichess; while the browser asks, Cancel. */
function OnlineWay({
  reconnect,
  connect,
  disabled
}: {
  reconnect: boolean;
  connect: ReturnType<typeof useLichessConnect>;
  disabled: boolean;
}) {
  return (
    <WayRow
      piece={{ color: "white", role: "knight" }}
      square="light"
      badge={<Globe />}
      title="Online"
      detail={
        connect.error ? (
          <span className="text-danger">{connect.error}</span>
        ) : connect.connecting ? (
          "Approve on lichess.org"
        ) : null
      }
      action={
        connect.connecting ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={wayButton}
            onClick={connect.cancel}
          >
            <Loader2 className="animate-spin motion-reduce:animate-none" />
            Cancel
          </Button>
        ) : (
          <Button
            type="button"
            variant="primary"
            size="sm"
            className={wayButton}
            disabled={disabled || !connect.available}
            onClick={connect.connect}
          >
            <Globe />
            {reconnect ? "Reconnect Lichess" : "Connect Lichess"}
          </Button>
        )
      }
    />
  );
}
