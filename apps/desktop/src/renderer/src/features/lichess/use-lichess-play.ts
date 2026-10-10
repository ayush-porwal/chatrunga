import { useEffect, useState } from "react";
import type { Color } from "@chaturanga/shared/types/chess";
import type { LichessSeekInput } from "@chaturanga/shared/types/lichess";
import { selectLiveGameInProgress, useLichessStore } from "../../stores/lichess-store";
import {
  CHALLENGE_PRESETS,
  SEEK_PRESETS,
  lichessErrorMessage,
  speedForClock,
  type LichessClockPreset
} from "./lichess-game";

export type ColorChoice = Color | "random";

/** The connected account's rating for a clock's speed (null without one). */
export function useLichessRating(preset: LichessClockPreset): number | null {
  const account = useLichessStore((state) => state.status.account);
  return account?.perfs[speedForClock(preset.minutes, preset.incrementSec)]?.rating ?? null;
}

/**
 * Quick pairing: the clock and Rated/Casual, and the seek itself (kept on the Lichess store, so the
 * search shows wherever Play is opened from). Lichess pairs by your rating; no range is sent.
 */
export function useLichessSeekSetup() {
  const account = useLichessStore((state) => state.status.account);
  const seek = useLichessStore((state) => state.seek);
  const seekError = useLichessStore((state) => state.seekError);
  const [preset, setPreset] = useState<LichessClockPreset>(SEEK_PRESETS[0]);
  const [rated, setRated] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function start() {
    const api = window.chaturanga?.lichess;
    const state = useLichessStore.getState();
    if (!api || !account || selectLiveGameInProgress(state) || state.seek) return;
    const input: LichessSeekInput = {
      minutes: preset.minutes,
      incrementSec: preset.incrementSec,
      rated
    };
    setError(null);
    state.setSeek({ input, startedAt: Date.now() });
    api.seek(input).catch((reason: unknown) => {
      useLichessStore.getState().setSeek(null);
      setError(lichessErrorMessage(reason, "Couldn’t start looking for a game."));
    });
  }

  function cancel() {
    useLichessStore.getState().setSeek(null);
    // The seek is already off here; a failed cancel only means Lichess dropped it first.
    window.chaturanga?.lichess.cancelSeek().catch(() => undefined);
  }

  return {
    seek,
    preset,
    setPreset,
    rated,
    setRated,
    error: error ?? seekError,
    start,
    cancel
  };
}

/** When each challenge was first seen here (sent from this window, or listed after a restart). */
const challengeSeenAt = new Map<string, number>();

/** Challenge a friend: their username, the clock, Rated/Casual, your colour, and the challenge sent. */
export function useFriendChallenge() {
  const challenges = useLichessStore((state) => state.challenges);
  const [username, setUsername] = useState("");
  const [preset, setPreset] = useState<LichessClockPreset>(CHALLENGE_PRESETS[2]);
  const [rated, setRated] = useState(false);
  const [color, setColor] = useState<ColorChoice>("random");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The newest of your challenges still waiting for an answer, and since when it has been.
  const waiting = challenges.filter((challenge) => challenge.direction === "out").at(-1) ?? null;
  const waitingId = waiting?.id ?? null;
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  useEffect(() => {
    if (!waitingId) {
      setWaitingSince(null);
      return;
    }
    if (!challengeSeenAt.has(waitingId)) challengeSeenAt.set(waitingId, Date.now());
    setWaitingSince(challengeSeenAt.get(waitingId) ?? null);
  }, [waitingId]);

  function send() {
    const api = window.chaturanga?.lichess;
    const name = username.trim();
    if (!api || !name || busy || selectLiveGameInProgress(useLichessStore.getState())) return;
    setBusy(true);
    setError(null);
    const sentAt = Date.now();
    api
      .challenge({
        username: name,
        minutes: preset.minutes,
        incrementSec: preset.incrementSec,
        rated,
        color
      })
      .then((challenge) => {
        challengeSeenAt.set(challenge.id, sentAt);
        useLichessStore.getState().upsertChallenge(challenge);
        setUsername("");
      })
      .catch((reason: unknown) =>
        setError(lichessErrorMessage(reason, "Couldn’t send the challenge."))
      )
      .finally(() => setBusy(false));
  }

  function cancelWaiting() {
    const api = window.chaturanga?.lichess;
    if (!api || !waiting) return;
    setError(null);
    api
      .cancelChallenge(waiting.id)
      .then(() => useLichessStore.getState().removeChallenge(waiting.id))
      .catch((reason: unknown) =>
        setError(lichessErrorMessage(reason, "Couldn’t cancel the challenge."))
      );
  }

  return {
    username,
    setUsername,
    preset,
    setPreset,
    rated,
    setRated,
    color,
    setColor,
    busy,
    error,
    send,
    /** `since`: epoch ms, null for the first render after it appears. */
    waiting: waiting ? { name: waiting.opponent.name, since: waitingSince } : null,
    cancelWaiting
  };
}

/** Play the Lichess AI: its level (1–8), the clock and your colour. */
export function useAiChallenge() {
  const [level, setLevel] = useState(3);
  const [preset, setPreset] = useState<LichessClockPreset>(CHALLENGE_PRESETS[3]);
  const [color, setColor] = useState<Color>("white");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function start() {
    const api = window.chaturanga?.lichess;
    if (!api || busy || selectLiveGameInProgress(useLichessStore.getState())) return;
    setBusy(true);
    setError(null);
    // Opened by its id (its gameStart event, if it arrives too, is the same game).
    api
      .challengeAi({ level, minutes: preset.minutes, incrementSec: preset.incrementSec, color })
      .then(({ gameId }) => useLichessStore.getState().resumeGame(gameId))
      .catch((reason: unknown) =>
        setError(lichessErrorMessage(reason, "Couldn’t start a game against the Lichess AI."))
      )
      .finally(() => setBusy(false));
  }

  return { level, setLevel, preset, setPreset, color, setColor, busy, error, start };
}

/** Whole seconds since `since` (epoch ms), ticking once a second; 0 without a start. */
export function useElapsedSeconds(since: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000));
}
