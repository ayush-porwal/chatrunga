import { randomUUID } from "node:crypto";
import type { CommentaryRequestContext } from "@chaturanga/shared/types/telemetry";
import type { CommentaryReport } from "../commentary/openrouter-commentary";
import { modelProperties } from "./properties";
import type { TelemetryService } from "./service";

type Totals = {
  requestId: string;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
  /** Every answered attempt reported its token counts (or cost). */
  tokensComplete: boolean;
  costComplete: boolean;
};

/**
 * Turns one `commentary:generate` call's reports into analytics events: per move one
 * `commentary_requested`, one `commentary_provider_attempt` per HTTP attempt and one terminal
 * `commentary_completed` / `commentary_failed` — so a batch with mixed results counts each move
 * once. Usage is summed over every answered attempt (including the corrective retry); totals
 * nobody reported stay unknown, and `*_complete` says whether they cover every attempt.
 */
export function commentaryReporter(
  telemetry: TelemetryService,
  context: CommentaryRequestContext | null,
  input: { model: string; detail: string | null }
): (event: CommentaryReport) => void {
  const requests = new Map<number, Totals>();
  const gameRef = telemetry.gameRef(context?.gameId);
  const common = {
    review_id: context?.reviewId ?? undefined,
    game_ref: gameRef ?? undefined,
    trigger: context?.trigger ?? "auto",
    detail: input.detail ?? undefined,
    ...modelProperties(input.model)
  };
  // Retry is a click; a request made on its own when a move is shown is not activity by itself.
  if (context?.trigger === "user_retry") telemetry.markActive("study");

  return (event) => {
    if (event.type === "request") {
      const totals: Totals = { requestId: randomUUID(), tokensComplete: true, costComplete: true };
      requests.set(event.ply, totals);
      telemetry.record("commentary_requested", {
        ...common,
        request_id: totals.requestId,
        ply: event.ply
      });
      return;
    }
    const totals = requests.get(event.ply);
    if (!totals) return;
    if (event.type === "attempt") {
      const answered = event.result === "accepted" || event.result === "validation_failed";
      if (answered) {
        totals.promptTokens = add(totals.promptTokens, event.usage?.promptTokens);
        totals.completionTokens = add(totals.completionTokens, event.usage?.completionTokens);
        totals.costUsd = add(totals.costUsd, event.usage?.costUsd);
        if (event.usage?.promptTokens === undefined || event.usage.completionTokens === undefined)
          totals.tokensComplete = false;
        if (event.usage?.costUsd === undefined) totals.costComplete = false;
      }
      telemetry.record("commentary_provider_attempt", {
        request_id: totals.requestId,
        attempt: event.attempt,
        reason: event.reason,
        result: event.result,
        http_status: event.httpStatus ?? undefined,
        latency_ms: Math.round(event.latencyMs),
        prompt_tokens: event.usage?.promptTokens,
        completion_tokens: event.usage?.completionTokens,
        cost_usd: event.usage?.costUsd,
        ...modelProperties(input.model)
      });
      return;
    }
    requests.delete(event.ply);
    const answeredAny = event.attempts > 0;
    telemetry.record(event.ok ? "commentary_completed" : "commentary_failed", {
      ...common,
      request_id: totals.requestId,
      ply: event.ply,
      error_code: event.code ?? undefined,
      attempts: event.attempts,
      validation_retried: event.attempts > 1,
      first_attempt_valid: event.firstAttemptValid,
      latency_ms: Math.round(event.latencyMs),
      prompt_tokens_total: totals.promptTokens,
      completion_tokens_total: totals.completionTokens,
      // Micro-dollars: sums of reported costs otherwise pick up floating-point noise.
      cost_usd_total:
        totals.costUsd === undefined ? undefined : Math.round(totals.costUsd * 1e6) / 1e6,
      tokens_complete: answeredAny && totals.tokensComplete && totals.promptTokens !== undefined,
      cost_complete: answeredAny && totals.costComplete && totals.costUsd !== undefined
    });
  };
}

/** Sums known values; unknown + unknown stays unknown (never 0). */
function add(total: number | undefined, value: number | undefined): number | undefined {
  if (value === undefined) return total;
  return (total ?? 0) + value;
}
