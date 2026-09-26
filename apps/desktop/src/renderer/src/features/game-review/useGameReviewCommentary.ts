import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReviewInsightPayload } from "@chaturanga/shared/schemas";
import type { GameReview, MoveReview, ReviewCommentary } from "@chaturanga/shared/types/engine";
import { useGameStore } from "../../stores/game-store";
import { useReviewStore } from "../../stores/review-store";
import { useOpenRouterConfigQuery } from "../../queries/api";
import { rendererCommentaryError, requestRendererCommentary } from "../../ipc/commentary";
import { DEFAULT_COMMENTARY_MODEL } from "@chaturanga/shared/llm/models";
import { buildInsightPayload, type CommentaryDetail } from "./review-utils";
import {
  CommentaryScheduler,
  commentarySettingsKey,
  decideCommentary,
  isCurrentCommentary,
  type CommentaryDecision,
  type CommentaryJob
} from "./commentary-scheduler";

const PROVIDER_FAILED = "OpenRouter didn't return commentary for this move.";

/**
 * What the Commentary panel shows for the selected move:
 * - `loading`: waiting for the debounce, the configuration or the provider;
 * - `ready`: `commentary` holds the AI explanation;
 * - `error`: the request failed (`error` says why); `retry` asks again for this move only;
 * - `no-key`: no OpenRouter key is saved; `off`: AI commentary is switched off;
 * - `no-payload`: the engine data for this move is too thin to explain;
 * - `idle`: nothing to show (review running, no move, tab hidden).
 */
export type CommentaryStatus = "idle" | "loading" | "ready" | "error" | "no-key" | "off" | "no-payload";

/** Commentary for the move currently in view. */
export type SelectedMoveCommentary = {
  status: CommentaryStatus;
  commentary: ReviewCommentary | undefined;
  /** The OpenRouter model writing the commentary (shown while loading). */
  model: string;
  error: string | null;
  retry: () => void;
};

type Options = {
  enabled: boolean;
  detail: CommentaryDetail;
  userRating: number;
  playerColor: "white" | "black";
  /** Saved settings have loaded; nothing is requested with placeholder defaults. */
  settingsReady: boolean;
  /** The reviewed move the user has selected. */
  move: MoveReview | null;
  /** The Commentary tab is visible. */
  visible: boolean;
};

/**
 * On-demand AI commentary for the Game Review workspace. Nothing is sent to a provider while the
 * engine pass runs or when it completes: once the review is ready, the move the user settles on
 * (Commentary tab visible) is requested alone after a debounce, and the result is cached per ply
 * in the review store — which the autosave persists with the game — so revisits never re-query.
 */
export function useGameReviewCommentary({
  enabled,
  detail,
  userRating,
  playerColor,
  settingsReady,
  move,
  visible
}: Options): SelectedMoveCommentary {
  const review = useReviewStore((state) => state.review);
  const reviewStatus = useReviewStore((state) => state.status);
  const headers = useGameStore((state) => state.headers);
  const openRouterConfig = useOpenRouterConfigQuery();
  const model = openRouterConfig.data?.model ?? "";
  const settingsKey = commentarySettingsKey({ model, detail, userRating, playerColor });
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [scheduler] = useState(() => new CommentaryScheduler());
  const settingsKeyRef = useRef(settingsKey);

  useEffect(() => {
    settingsKeyRef.current = settingsKey;
  }, [settingsKey]);

  useEffect(() => () => scheduler.dispose(), [scheduler]);

  const reviewedMove = review && move && review.moves.some((item) => item.nodeId === move.nodeId) ? move : null;
  const active = visible && reviewStatus === "ready" && Boolean(reviewedMove);
  const reviewMoves = review?.moves;
  const white = headers.white ?? undefined;
  const black = headers.black ?? undefined;
  const event = headers.event ?? undefined;
  const opening = headers.opening ?? undefined;
  const schemaVersion = review?.schemaVersion;
  const engineName = review?.engineName;
  const engineSettings = review?.engineSettings;
  const reviewDepth = review?.depth;
  const reviewMoveTimeMs = review?.moveTimeMs;
  const payloadContext = useMemo(
    () =>
      reviewMoves
        ? {
          moves: reviewMoves,
          headers: { white, black, event, opening },
          review: { schemaVersion, engineName, engineSettings, depth: reviewDepth, moveTimeMs: reviewMoveTimeMs }
        }
        : undefined,
    [black, engineName, engineSettings, event, opening, reviewDepth, reviewMoveTimeMs, reviewMoves, schemaVersion, white]
  );
  const payload = useMemo(() => {
    if (!active || !reviewedMove || !payloadContext) return null;
    return buildInsightPayload(reviewedMove, userRating, detail, playerColor, payloadContext);
  }, [active, detail, payloadContext, playerColor, reviewedMove, userRating]);
  const cached = reviewedMove ? review?.commentary?.find((item) => item.ply === reviewedMove.ply) : undefined;
  const jobKey = review && reviewedMove ? `${review.createdAt}:${reviewedMove.ply}:${settingsKey}` : "";
  const decision = decideCommentary({
    active,
    enabled,
    configLoading: !settingsReady || openRouterConfig.isLoading,
    hasApiKey: Boolean(openRouterConfig.data?.hasApiKey),
    hasPayload: Boolean(payload),
    cached,
    settingsKey,
    failed: Boolean(jobKey && failures[jobKey])
  });

  const requestOne = useCallback(async (input: {
    payload: ReviewInsightPayload;
    target: GameReview;
    key: string;
    settingsKey: string;
  }) => {
    const stale = () => !isCurrentReview(input.target) || settingsKeyRef.current !== input.settingsKey;
    const fail = (message: string) => {
      if (stale()) return;
      setFailures((current) => ({ ...current, [input.key]: message }));
    };
    const store = (item: ReviewCommentary | undefined, error: string | null) => {
      if (stale()) return;
      if (item) {
        useReviewStore.getState().addCommentary({ ...item, settingsKey: input.settingsKey });
        return;
      }
      fail(error ?? PROVIDER_FAILED);
    };

    try {
      const result = await requestRendererCommentary({ payloads: [input.payload] });
      store(result.commentary.find((item) => item.ply === input.payload.game.ply), result.error);
    } catch (error) {
      fail(rendererCommentaryError(error));
    }
  }, []);

  const job = useMemo<CommentaryJob | null>(() => {
    if (!payload || !review || !jobKey) return null;
    const input = { payload, target: review, key: jobKey, settingsKey };
    return { key: jobKey, run: () => requestOne(input) };
    // `review` changes whenever commentary is cached; the job only needs the review identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobKey, payload, requestOne]);

  useEffect(() => {
    scheduler.schedule(decision === "request" ? job : null);
  }, [decision, job, scheduler]);

  const retry = useCallback(() => {
    if (!job) return;
    setFailures((current) => {
      const next = { ...current };
      delete next[job.key];
      return next;
    });
    scheduler.runNow(job);
  }, [job, scheduler]);

  return {
    status: statusFor(decision, isCurrentCommentary(cached, settingsKey)),
    commentary: cached,
    model: model || DEFAULT_COMMENTARY_MODEL,
    error: decision === "failed" ? failures[jobKey] ?? PROVIDER_FAILED : null,
    retry
  };
}

function statusFor(decision: CommentaryDecision, hasCurrent: boolean): CommentaryStatus {
  switch (decision) {
    case "idle":
      return "idle";
    case "request":
    case "waiting":
      return "loading";
    case "cached":
      return "ready";
    case "failed":
      return "error";
    // Commentary saved earlier still shows when it is switched off or the key was removed.
    case "off":
    case "no-key":
    case "no-payload":
      return hasCurrent ? "ready" : decision;
  }
}

function isCurrentReview(target: GameReview): boolean {
  return useReviewStore.getState().review?.createdAt === target.createdAt;
}
