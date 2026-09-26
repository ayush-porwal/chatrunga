import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReviewInsightPayload } from "@chaturanga/shared/schemas";
import type { GameReview, MoveReview, ReviewCommentary } from "@chaturanga/shared/types/engine";
import { useGameStore } from "../../stores/game-store";
import { useReviewStore } from "../../stores/review-store";
import { useOpenRouterConfigQuery } from "../../queries/api";
import { rendererCommentaryError, requestRendererCommentary } from "../../ipc/commentary";
import type { CoachParts } from "@chaturanga/shared/llm/commentary";
import { buildInsightPayload, localCoachCommentary, type CommentaryDetail } from "./review-utils";
import {
  CommentaryScheduler,
  commentarySettingsKey,
  decideCommentary,
  isAiCommentary,
  type CommentaryJob,
  type CommentaryProvider
} from "./commentary-scheduler";

const PROVIDER_FAILED = "AI commentary was unavailable for this move; the local explanation is shown.";

/** Commentary for the move currently in view. */
export type SelectedMoveCommentary = {
  /** Provider-written explanation to show (may belong to older settings while a refresh loads). */
  commentary: ReviewCommentary | undefined;
  /** Deterministic explanation (headline, body, takeaway), shown immediately and whenever no AI explanation exists. */
  local: CoachParts | null;
  /** An AI explanation for this move is being prepared. */
  pending: boolean;
  error: string | null;
  canRetry: boolean;
  retry: () => void;
};

type Options = {
  enabled: boolean;
  provider: CommentaryProvider;
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
  provider,
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
  const model = provider === "openrouter" ? openRouterConfig.data?.model ?? "" : "";
  const settingsKey = commentarySettingsKey({ provider, model, detail, userRating, playerColor });
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
  const providerReady = provider === "openrouter" && Boolean(openRouterConfig.data?.hasApiKey);
  const decision = decideCommentary({
    active,
    enabled,
    provider,
    providerLoading: !settingsReady || (provider === "openrouter" && openRouterConfig.isLoading),
    providerReady,
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
      if (item && isAiCommentary(item)) {
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

  const local = useMemo(
    () => (reviewedMove ? localCoachCommentary(reviewedMove, detail, { userRating, playerColor, context: payloadContext }) : null),
    [detail, payloadContext, playerColor, reviewedMove, userRating]
  );
  const unavailable = decision === "unavailable"
    ? "Add an OpenRouter API key in Review settings for AI commentary. The local explanation is shown."
    : null;

  return {
    commentary: isAiCommentary(cached) ? cached : undefined,
    local,
    pending: decision === "request" || decision === "waiting",
    error: (jobKey && failures[jobKey]) || unavailable,
    canRetry: decision === "failed",
    retry: () => {
      if (!job) return;
      setFailures((current) => {
        const next = { ...current };
        delete next[job.key];
        return next;
      });
      scheduler.runNow(job);
    }
  };
}

function isCurrentReview(target: GameReview): boolean {
  return useReviewStore.getState().review?.createdAt === target.createdAt;
}
