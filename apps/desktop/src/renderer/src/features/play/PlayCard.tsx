import { memo, useMemo, useRef, useState, type ReactNode } from "react";
import { Download, Globe, Loader2, RefreshCw, Settings } from "lucide-react";
import { START_FEN } from "@chaturanga/shared/chess/position";
import type { PlayOpponent } from "@chaturanga/shared/types/settings";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useSettingsQuery, useUpdateSettingsMutation } from "../../queries/api";
import { selectLiveGameInProgress, useLichessStore } from "../../stores/lichess-store";
import { useLichessConnect } from "../lichess/LichessAccount";
import {
  useAiChallenge,
  useElapsedSeconds,
  useFriendChallenge,
  useLichessRating,
  useLichessSeekSetup
} from "../lichess/use-lichess-play";
import { useEngineSetup } from "../onboarding/useEngineSetup";
import { gameFromInitialSession } from "../repertoire/handoffs";
import { BoardThumbnail } from "../settings/board-thumbnail";
import { PlaySettingsDialog } from "./PlaySettingsDialog";
import { ErrorLine, LiveGameNote, Matchup, WayRow, wayButton } from "./play-card-parts";
import {
  aiView,
  boardView,
  engineView,
  firstRunView,
  friendView,
  HandoffStrip,
  poolView,
  type CardView,
  type LichessContext
} from "./play-card-views";
import { WIDE_CONTROLS_MAX, WIDE_GAP, resolvePlayMode, savePlaySettings } from "./play-layout";
import { useWidePreviewSize } from "./use-wide-preview-size";
import { useEngineGameSetup, type EngineGameSetup } from "./use-engine-game-setup";

const cardShell = "min-w-0 rounded-xl border border-line bg-surface leading-[1.43]";

export type PlayCardProps = {
  /** Room for the preview board, on the left. */
  wide: boolean;
  /** No engine and no Lichess account yet: the two ways to get an opponent. */
  firstRun: boolean;
  desktopApiAvailable: boolean;
  onOpenEngineSettings: () => void;
  onBeforeEngineGame: () => void;
  onEngineGameStarted: () => void;
  onFreeBoard: () => void;
};

/**
 * Play: you against the opponent chosen in Play settings (an engine, Quick pairing, a friend, the
 * Lichess AI, or a free board), its time control and options, and the button that starts the game.
 * The You-vs-opponent header takes whatever height the controls leave, so the card keeps the
 * row's height. Wide, a preview board sits on the left.
 */
export const PlayCard = memo(function PlayCard({
  wide,
  firstRun,
  desktopApiAvailable,
  onOpenEngineSettings,
  onBeforeEngineGame,
  onEngineGameStarted,
  onFreeBoard
}: PlayCardProps) {
  const wideBodyRef = useRef<HTMLDivElement | null>(null);
  const boardSize = useWidePreviewSize(wideBodyRef, wide);
  const settings = useSettingsQuery();
  const lichess = useLichessPlayAccount();
  const liveGame = useLichessStore(selectLiveGameInProgress);
  const mode = resolvePlayMode({
    session: lichess.session,
    saved: settings.data?.playOpponent ?? null,
    hasAccount: lichess.account !== null,
    connected: lichess.connected
  });

  const engine = useEngineGameSetup({
    onBeforeStart: onBeforeEngineGame,
    onStart: onEngineGameStarted
  });
  const opponents = useLichessOpponents();
  const connect = useLichessConnect();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const updateSettings = useUpdateSettingsMutation();
  const handoffFen = useMemo(() => {
    const initial = engine.initialSession;
    return initial ? (gameFromInitialSession(initial, {})?.currentFen ?? initial.rootFen) : null;
  }, [engine.initialSession]);

  const onlineWay = (
    <OnlineWay
      reconnect={lichess.account !== null}
      connect={connect}
      disabled={!desktopApiAvailable}
    />
  );
  const enginesWay = (
    <EnginesWay disabled={!desktopApiAvailable} onOpenEngineSettings={onOpenEngineSettings} />
  );
  // A repertoire handoff (Play from here) stays in view while an opponent is set up, too.
  const handoffStrip = engine.initialSession ? (
    <HandoffStrip
      fen={handoffFen ?? engine.initialSession.rootFen}
      color={engine.initialSession.playerColor}
      label={engine.initialSession.label}
      onClear={engine.clearInitialSession}
    />
  ) : null;

  const view = firstRun
    ? firstRunView(
        <>
          {handoffStrip}
          {enginesWay}
          {onlineWay}
        </>
      )
    : opponentView(mode, {
        engine,
        handoffFen,
        handoffStrip,
        enginesWay,
        opponents,
        lichess: { locked: !lichess.connected, onlineWay, apiAvailable: desktopApiAvailable },
        onFreeBoard
      });
  // A Lichess game owns the board: the setup stays in view, dimmed, and the footer says why.
  const { header, body, footer } = cardParts(view, liveGame && !firstRun, wide);
  const gear = (
    <IconButton
      label="Play settings"
      icon={<Settings />}
      className="absolute right-2 top-2 z-[2] size-7.5 rounded-[7px] text-fg-muted"
      onClick={() => setSettingsOpen(true)}
    />
  );

  return (
    <section aria-label="Play" className={cn(cardShell, "play-card relative flex flex-col")}>
      {gear}
      {wide ? (
        <div
          ref={wideBodyRef}
          // The board never sets the height (it is sized to the body, the row's height). In a wide
          // card the board and the controls (never wider than WIDE_CONTROLS_MAX) stay together in
          // the middle, rather than the controls stretching across it.
          className="grid min-h-0 flex-1 justify-center py-3 pl-3 pr-4"
          style={{
            columnGap: WIDE_GAP,
            gridTemplateColumns: boardSize
              ? `${boardSize}px minmax(0, ${WIDE_CONTROLS_MAX}px)`
              : `minmax(0, 47.7%) minmax(0, ${WIDE_CONTROLS_MAX}px)`
          }}
        >
          <PreviewBoard view={view} size={boardSize} />
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
          lichess={lichess.profile}
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

/**
 * The Lichess account the card plays with: linked (`account`), still accepted (`connected`), its
 * name and rapid rating for Play settings (`profile`, null until connected), and the opponent
 * picked this session.
 */
function useLichessPlayAccount() {
  const status = useLichessStore((state) => state.status);
  const session = useLichessStore((state) => state.playOpponent);
  const account = status.account;
  const connected = account !== null && !status.tokenRejected;
  return {
    account,
    connected,
    session,
    profile: connected
      ? { username: account.username, rating: account.perfs.rapid?.rating ?? null }
      : null
  };
}

/** The Lichess opponents' setups, with your rating at each one's time control and the waits. */
function useLichessOpponents() {
  const seek = useLichessSeekSetup();
  const friend = useFriendChallenge();
  const ai = useAiChallenge();
  const poolRating = useLichessRating(seek.preset);
  const friendRating = useLichessRating(friend.preset);
  const aiRating = useLichessRating(ai.preset);
  const seekSeconds = useElapsedSeconds(seek.seek?.startedAt ?? null);
  const waitSeconds = useElapsedSeconds(friend.waiting?.since ?? null);
  return {
    pool: { seek, rating: poolRating, seconds: seekSeconds },
    friend: { friend, rating: friendRating, seconds: waitSeconds },
    ai: { ai, rating: aiRating }
  };
}

/** The view for the opponent chosen in Play settings. */
function opponentView(
  mode: PlayOpponent,
  deps: {
    engine: EngineGameSetup;
    handoffFen: string | null;
    handoffStrip: ReactNode;
    enginesWay: ReactNode;
    opponents: ReturnType<typeof useLichessOpponents>;
    lichess: LichessContext;
    onFreeBoard: () => void;
  }
): CardView {
  switch (mode) {
    case "engine":
      return engineView(deps);
    case "pool":
      return poolView(deps.opponents.pool, deps.lichess);
    case "friend":
      return friendView(deps.opponents.friend, deps.lichess);
    case "ai":
      return aiView(deps.opponents.ai, deps.lichess);
    case "board":
      return boardView(deps.onFreeBoard);
  }
}

/**
 * The card's header, body and footer from its view. `locked` (a Lichess game owns the board): the
 * setup stays in view, dimmed and unusable, and the footer says why instead of offering a button.
 */
function cardParts(view: CardView, locked: boolean, wide: boolean) {
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
  return { header, body, footer };
}

/** The wide card's preview board: the position the game starts from, as you'll face it. */
function PreviewBoard({ view, size }: { view: CardView; size: number | null }) {
  return (
    <div className="relative min-h-0">
      <div
        className="absolute inset-y-0 left-0 grid content-center"
        style={{ width: size ?? "100%" }}
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
