import { randomUUID } from "node:crypto";
import type { CommentaryRequestContext } from "@chaturanga/shared/types/telemetry";
import type { ChatMessage, CommentaryReport } from "../commentary/openrouter-commentary";
import { modelProperties } from "./properties";
import type { TelemetryService } from "./service";

/** PostHog LLM analytics: the provider and API base every generation went to. */
const AI_PROVIDER = "openrouter";
const AI_BASE_URL = "https://openrouter.ai/api/v1";

type Totals = {
  requestId: string;
  /** The first attempt's prompt: the trace's input. */
  input?: readonly ChatMessage[];
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
  /** Every answered attempt reported its token counts (or cost). */
  tokensComplete: boolean;
  costComplete: boolean;
};

/**
 * Turns one `commentary:generate` call's reports into analytics events: per move one
 * `commentary_requested`, one `$ai_generation` per HTTP attempt (PostHog LLM analytics: prompt,
 * answer, model, tokens, cost, latency), and at the end one `$ai_trace` plus one terminal
 * `commentary_completed` / `commentary_failed` — so a batch with mixed results counts each move
 * once. The move's `request_id` is the trace id. Usage is summed over every answered attempt
 * (including the corrective retry); totals nobody reported stay unknown, and `*_complete` says
 * whether they cover every attempt. The API key is never part of a report.
 */
export function commentaryReporter(
  telemetry: TelemetryService,
  context: CommentaryRequestContext | null,
  input: { model: string; detail: string | null }
): (event: CommentaryReport) => void {
  const requests = new Map<number, Totals>();
  const gameRef = telemetry.gameRef(context?.gameId);
  const model = modelProperties(input.model);
  const common = {
    review_id: context?.reviewId ?? undefined,
    game_ref: gameRef ?? undefined,
    trigger: context?.trigger ?? "auto",
    detail: input.detail ?? undefined,
    ...model
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
      totals.input ??= event.request.messages;
      if (answered) {
        totals.promptTokens = add(totals.promptTokens, event.usage?.promptTokens);
        totals.completionTokens = add(totals.completionTokens, event.usage?.completionTokens);
        totals.costUsd = add(totals.costUsd, event.usage?.costUsd);
        if (event.usage?.promptTokens === undefined || event.usage.completionTokens === undefined)
          totals.tokensComplete = false;
        if (event.usage?.costUsd === undefined) totals.costComplete = false;
      }
      telemetry.record("$ai_generation", {
        ...common,
        request_id: totals.requestId,
        ply: event.ply,
        attempt: event.attempt,
        reason: event.reason,
        result: event.result,
        $ai_trace_id: totals.requestId,
        $ai_span_id: randomUUID(),
        $ai_span_name: event.reason === "initial" ? "commentary" : "commentary validation retry",
        $ai_provider: AI_PROVIDER,
        $ai_base_url: AI_BASE_URL,
        $ai_model: model.model,
        $ai_input: event.request.messages.map((message) => ({ ...message })),
        $ai_output_choices:
          event.output === null ? undefined : [{ role: "assistant", content: event.output }],
        $ai_input_tokens: event.usage?.promptTokens,
        $ai_output_tokens: event.usage?.completionTokens,
        $ai_total_cost_usd: event.usage?.costUsd,
        $ai_latency: seconds(event.latencyMs),
        $ai_http_status: event.httpStatus ?? undefined,
        $ai_temperature: event.request.temperature,
        $ai_max_tokens: event.request.maxTokens,
        $ai_stream: false,
        // No answer arrived; an answer that failed validation is recorded as `result` instead.
        $ai_is_error: !answered,
        $ai_error: answered ? undefined : event.result
      });
      return;
    }
    requests.delete(event.ply);
    const answeredAny = event.attempts > 0;
    if (answeredAny) {
      telemetry.record("$ai_trace", {
        ...common,
        request_id: totals.requestId,
        ply: event.ply,
        $ai_trace_id: totals.requestId,
        $ai_span_name: `commentary for ply ${event.ply}`,
        $ai_input_state: totals.input?.map((message) => ({ ...message })),
        $ai_output_state: event.prose,
        $ai_latency: seconds(event.latencyMs),
        $ai_is_error: !event.ok,
        $ai_error: event.code ?? undefined
      });
    }
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

/** PostHog's `$ai_latency` is in seconds. */
function seconds(ms: number): number {
  return Math.round(ms) / 1000;
}
