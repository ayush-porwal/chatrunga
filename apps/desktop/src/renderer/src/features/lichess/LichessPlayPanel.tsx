import { useEffect, useState, type ReactNode } from "react";
import { Bot, Check, Globe, Loader2, Play, Send, Swords, UserRound, X } from "lucide-react";
import type { Color } from "@chaturanga/shared/types/chess";
import type { LichessChallenge } from "@chaturanga/shared/types/lichess";
import { selectLiveGameInProgress, useLichessStore } from "../../stores/lichess-store";
import { ChipButton } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Eyebrow, SectionHeader } from "@/components/ui/page";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SideDot } from "@/components/ui/side-dot";
import { cardPadded, fieldHint, listRow } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { LichessConnectButton, LichessRatings } from "./LichessAccount";
import {
  CHALLENGE_PRESETS,
  SEEK_PRESETS,
  lichessErrorMessage,
  playerLabel,
  presetLabel,
  speedForClock,
  speedLabel,
  type LichessClockPreset
} from "./lichess-game";

type RatingRange = "any" | "100" | "200" | "400";
type ColorChoice = Color | "random";

const ratingRangeOptions = [
  { value: "any", label: "Any" },
  { value: "100", label: "±100" },
  { value: "200", label: "±200" },
  { value: "400", label: "±400" }
] as const;

const ratedOptions = [
  { value: "rated", label: "Rated" },
  { value: "casual", label: "Casual" }
] as const;

const colorOptions = [
  { value: "random", label: "Random" },
  { value: "white", label: "White", icon: <SideDot color="white" /> },
  { value: "black", label: "Black", icon: <SideDot color="black" /> }
] as const;

const AI_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/** Quick pairing selection, shared with the page header's primary action. */
export function useLichessSeekSetup() {
  const account = useLichessStore((state) => state.status.account);
  const tokenRejected = useLichessStore((state) => state.status.tokenRejected);
  const seek = useLichessStore((state) => state.seek);
  const seekError = useLichessStore((state) => state.seekError);
  const liveGame = useLichessStore(selectLiveGameInProgress);
  const [preset, setPreset] = useState<LichessClockPreset>(SEEK_PRESETS[0]);
  const [rated, setRated] = useState(true);
  const [range, setRange] = useState<RatingRange>("any");
  const [error, setError] = useState<string | null>(null);
  const rating = account?.perfs[speedForClock(preset.minutes, preset.incrementSec)]?.rating ?? 1500;

  function start() {
    const api = window.chaturanga?.lichess;
    if (!api || !account) return;
    const input = {
      minutes: preset.minutes,
      incrementSec: preset.incrementSec,
      rated,
      ratingRange: range === "any" ? null : ([rating - Number(range), rating + Number(range)] as [number, number])
    };
    setError(null);
    useLichessStore.getState().setSeek({ input, startedAt: Date.now() });
    api.seek(input).catch((reason: unknown) => {
      useLichessStore.getState().setSeek(null);
      setError(lichessErrorMessage(reason, "Couldn’t start looking for a game."));
    });
  }

  function cancel() {
    useLichessStore.getState().setSeek(null);
    void window.chaturanga?.lichess.cancelSeek();
  }

  return {
    connected: Boolean(account) && !tokenRejected,
    ready: Boolean(account) && !tokenRejected && !liveGame,
    seeking: Boolean(seek),
    preset,
    setPreset,
    rated,
    setRated,
    range,
    setRange,
    rating,
    error: error ?? seekError,
    start,
    cancel
  };
}

type LichessSeekSetup = ReturnType<typeof useLichessSeekSetup>;

/** Page header action: Play <clock> (or Cancel while seeking); nothing until an account is connected. */
export function LichessPlayActions({ setup }: { setup: LichessSeekSetup }) {
  if (!setup.connected) return null;
  if (setup.seeking) {
    return (
      <Button type="button" variant="outline" onClick={setup.cancel}>
        Cancel
      </Button>
    );
  }
  return (
    <Button type="button" variant="primary" disabled={!setup.ready} onClick={setup.start}>
      <Play />
      Play {presetLabel(setup.preset)}
    </Button>
  );
}

/** Play → Lichess: quick pairing, challenges (friend, Lichess AI), incoming challenges, games to resume. */
export function LichessPlayPanel({ setup, onOpenGame }: { setup: LichessSeekSetup; onOpenGame: () => void }) {
  const status = useLichessStore((state) => state.status);
  const loaded = useLichessStore((state) => state.loaded);
  const liveGame = useLichessStore(selectLiveGameInProgress);
  const ongoingGameIds = useLichessStore((state) => state.ongoingGameIds);
  const challenges = useLichessStore((state) => state.challenges);
  const account = status.account;

  if (!loaded) return null;
  if (!account || status.tokenRejected) {
    return (
      <section className={cardPadded}>
        <EmptyState
          icon={<Globe />}
          title={account ? "Reconnect your Lichess account" : "Connect your Lichess account"}
          description="Play rated games on lichess.org and review them here. You sign in on lichess.org; Chaturanga never sees your password."
          action={<LichessConnectButton label={account ? "Reconnect" : undefined} />}
        />
      </section>
    );
  }

  const incoming = challenges.filter((challenge) => challenge.direction === "in");
  const outgoing = challenges.filter((challenge) => challenge.direction === "out");

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-sm font-medium text-fg">{account.username}</span>
        <LichessRatings account={account} />
      </div>

      {liveGame ? (
        <Notice
          tone="info"
          title="You have a game in progress"
          action={
            <Button type="button" variant="primary" size="sm" onClick={onOpenGame}>
              Back to the game
            </Button>
          }
        >
          Finish it before starting another one.
        </Notice>
      ) : null}

      {ongoingGameIds.length && !liveGame ? (
        <RowList title="Games in progress">
          {ongoingGameIds.map((id) => (
            <li key={id} className={cn(listRow, "justify-between")}>
              <span className="truncate text-sm text-fg-secondary">Game {id}</span>
              <Button type="button" variant="primary" size="sm" onClick={() => useLichessStore.getState().resumeGame(id)}>
                Resume
              </Button>
            </li>
          ))}
        </RowList>
      ) : null}

      {incoming.length ? (
        <RowList title="Challenges for you">
          {incoming.map((challenge) => (
            <ChallengeRow key={challenge.id} challenge={challenge} disabled={liveGame} />
          ))}
        </RowList>
      ) : null}

      <QuickPairing setup={setup} />
      <div className="grid gap-4 @container">
        <div className="grid gap-4 @3xl:grid-cols-2">
          <FriendChallenge outgoing={outgoing} disabled={liveGame} />
          <AiChallenge disabled={liveGame} />
        </div>
      </div>
    </div>
  );
}

function QuickPairing({ setup }: { setup: LichessSeekSetup }) {
  return (
    <section className={cn(cardPadded, "grid gap-4")}>
      <SectionHeader as="h3" title="Quick pairing" description="Rapid and classical games against someone from the Lichess lobby." />
      {setup.seeking ? (
        <Seeking setup={setup} />
      ) : (
        <>
          <ClockChoice presets={SEEK_PRESETS} value={setup.preset} onChange={setup.setPreset} label="Time control" />
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <Field label="Game">
              <SegmentedControl
                ariaLabel="Rated or casual"
                value={setup.rated ? "rated" : "casual"}
                onChange={(value) => setup.setRated(value === "rated")}
                options={ratedOptions}
                className="w-fit"
              />
            </Field>
            <Field label="Opponent rating" hint={`you: ${setup.rating}`}>
              <SegmentedControl
                ariaLabel="Opponent rating range"
                value={setup.range}
                onChange={setup.setRange}
                options={ratingRangeOptions}
                className="w-fit"
              />
            </Field>
          </div>
          <p className={fieldHint}>
            Lichess only lets apps join rapid and slower lobby games. For blitz, challenge a friend or the Lichess AI below; bullet is
            only on{" "}
            <a href="https://lichess.org" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-fg">
              lichess.org
            </a>
            .
          </p>
          {setup.error ? <Notice tone="danger">{setup.error}</Notice> : null}
        </>
      )}
    </section>
  );
}

function Seeking({ setup }: { setup: LichessSeekSetup }) {
  const seek = useLichessStore((state) => state.seek);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  if (!seek) return null;
  const elapsed = Math.max(0, Math.floor((now - seek.startedAt) / 1000));
  const range = seek.input.ratingRange ? ` · ${seek.input.ratingRange[0]}–${seek.input.ratingRange[1]}` : "";
  return (
    <div className="flex flex-wrap items-center gap-3" role="status">
      <Loader2 className="size-5 animate-spin text-accent" aria-hidden="true" />
      <div className="grid gap-0.5">
        <span className="text-sm font-medium text-fg">Finding an opponent…</span>
        <span className="text-xs text-fg-muted">
          {seek.input.minutes}+{seek.input.incrementSec} · {seek.input.rated ? "Rated" : "Casual"}
          {range} · {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
        </span>
      </div>
      <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={setup.cancel}>
        Cancel
      </Button>
    </div>
  );
}

function FriendChallenge({ outgoing, disabled }: { outgoing: LichessChallenge[]; disabled: boolean }) {
  const [username, setUsername] = useState("");
  const [preset, setPreset] = useState<LichessClockPreset>(CHALLENGE_PRESETS[2]);
  const [rated, setRated] = useState(false);
  const [color, setColor] = useState<ColorChoice>("random");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function send() {
    const api = window.chaturanga?.lichess;
    const name = username.trim();
    if (!api || !name) return;
    setBusy(true);
    setError(null);
    api
      .challenge({ username: name, minutes: preset.minutes, incrementSec: preset.incrementSec, rated, color })
      .then((challenge) => {
        useLichessStore.getState().upsertChallenge(challenge);
        setUsername("");
      })
      .catch((reason: unknown) => setError(lichessErrorMessage(reason, "Couldn’t send the challenge.")))
      .finally(() => setBusy(false));
  }

  return (
    <section className={cn(cardPadded, "grid content-start gap-4")}>
      <SectionHeader as="h3" title="Challenge a friend" description="Any time control, blitz included." />
      <Field label="Lichess username" htmlFor="lichess-challenge-user">
        <Input
          id="lichess-challenge-user"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") send();
          }}
          placeholder="Username"
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <ClockChoice presets={CHALLENGE_PRESETS} value={preset} onChange={setPreset} label="Time control" />
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <Field label="You play">
          <SegmentedControl ariaLabel="You play" value={color} onChange={setColor} options={colorOptions} className="w-fit" />
        </Field>
        <Field label="Game">
          <SegmentedControl
            ariaLabel="Rated or casual challenge"
            value={rated ? "rated" : "casual"}
            onChange={(value) => setRated(value === "rated")}
            options={ratedOptions}
            className="w-fit"
          />
        </Field>
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div>
        <Button type="button" variant="outline" disabled={disabled || busy || !username.trim()} onClick={send}>
          <Send />
          Send challenge
        </Button>
      </div>
      {outgoing.length ? (
        <RowList title="Waiting for an answer">
          {outgoing.map((challenge) => (
            <ChallengeRow key={challenge.id} challenge={challenge} disabled={false} />
          ))}
        </RowList>
      ) : null}
    </section>
  );
}

function AiChallenge({ disabled }: { disabled: boolean }) {
  const [level, setLevel] = useState<number>(3);
  const [preset, setPreset] = useState<LichessClockPreset>(CHALLENGE_PRESETS[3]);
  const [color, setColor] = useState<ColorChoice>("random");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function start() {
    const api = window.chaturanga?.lichess;
    if (!api) return;
    setBusy(true);
    setError(null);
    // The game opens through its gameStart event, like any other.
    api
      .challengeAi({ level, minutes: preset.minutes, incrementSec: preset.incrementSec, color })
      .catch((reason: unknown) => setError(lichessErrorMessage(reason, "Couldn’t start a game against the Lichess AI.")))
      .finally(() => setBusy(false));
  }

  return (
    <section className={cn(cardPadded, "grid content-start gap-4")}>
      <SectionHeader as="h3" title="Play the Lichess AI" description="Stockfish on Lichess’s servers. Saved like any Lichess game." />
      <div className="grid gap-1.5">
        <Eyebrow>Level</Eyebrow>
        <div role="radiogroup" aria-label="Lichess AI level" className="flex flex-wrap gap-1.5">
          {AI_LEVELS.map((value) => (
            <ChipButton
              key={value}
              role="radio"
              aria-checked={level === value}
              aria-pressed={undefined}
              selected={level === value}
              className="min-w-9 justify-center tabular-nums"
              onClick={() => setLevel(value)}
            >
              {value}
            </ChipButton>
          ))}
        </div>
      </div>
      <ClockChoice presets={CHALLENGE_PRESETS} value={preset} onChange={setPreset} label="Time control" />
      <Field label="You play">
        <SegmentedControl ariaLabel="You play against the AI" value={color} onChange={setColor} options={colorOptions} className="w-fit" />
      </Field>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div>
        <Button type="button" variant="outline" disabled={disabled || busy} onClick={start}>
          <Bot />
          Play level {level}
        </Button>
      </div>
    </section>
  );
}

function ChallengeRow({ challenge, disabled }: { challenge: LichessChallenge; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const api = window.chaturanga?.lichess;
  const clock = challenge.timeControl ? `${challenge.timeControl.minutes}+${challenge.timeControl.incrementSec}` : "Unlimited";
  const side = challenge.yourColor === "random" ? "random side" : `you play ${challenge.yourColor}`;
  const rating = challenge.opponent.rating ? ` (${challenge.opponent.rating})` : "";

  function run(action: ((id: string) => Promise<void>) | undefined) {
    if (!action) return;
    setBusy(true);
    action(challenge.id)
      .then(() => useLichessStore.getState().removeChallenge(challenge.id))
      .catch(() => setBusy(false));
  }

  return (
    <li className={cn(listRow, "justify-between gap-3")}>
      <span className="flex min-w-0 items-center gap-2.5">
        {challenge.direction === "in" ? <Swords className="size-4 shrink-0 text-accent" /> : <UserRound className="size-4 shrink-0 text-fg-muted" />}
        <span className="grid min-w-0">
          <span className="truncate text-sm font-medium text-fg-secondary">
            {playerLabel(challenge.opponent)}
            {rating}
          </span>
          <span className="truncate text-xs text-fg-muted">
            {clock} {speedLabel(challenge.speed)} · {challenge.rated ? "Rated" : "Casual"} · {side}
          </span>
        </span>
      </span>
      {challenge.direction === "in" ? (
        <span className="flex shrink-0 gap-1.5">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => run(api?.declineChallenge)}>
            <X />
            Decline
          </Button>
          <Button type="button" variant="primary" size="sm" disabled={busy || disabled} onClick={() => run(api?.acceptChallenge)}>
            <Check />
            Accept
          </Button>
        </span>
      ) : (
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => run(api?.cancelChallenge)}>
          Cancel
        </Button>
      )}
    </li>
  );
}

/** Time control chips, like the engine game's. */
function ClockChoice({
  presets,
  value,
  onChange,
  label
}: {
  presets: readonly LichessClockPreset[];
  value: LichessClockPreset;
  onChange: (preset: LichessClockPreset) => void;
  label: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Eyebrow>{label}</Eyebrow>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {presets.map((preset) => {
          const selected = preset.minutes === value.minutes && preset.incrementSec === value.incrementSec;
          return (
            <ChipButton
              key={presetLabel(preset)}
              role="radio"
              aria-checked={selected}
              aria-pressed={undefined}
              selected={selected}
              className="min-w-14 justify-center tabular-nums"
              onClick={() => onChange(preset)}
            >
              {presetLabel(preset)}
              <span className="text-fg-subtle">{speedLabel(speedForClock(preset.minutes, preset.incrementSec))}</span>
            </ChipButton>
          );
        })}
      </div>
    </div>
  );
}

function RowList({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <Eyebrow>{title}</Eyebrow>
      <ul className="grid gap-1.5">{children}</ul>
    </section>
  );
}
