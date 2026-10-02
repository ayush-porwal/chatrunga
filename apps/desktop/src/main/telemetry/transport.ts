import type { TelemetryProject } from "./config";
import type { OutboxEvent } from "./outbox";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/**
 * What became of a batch:
 * - `accepted`: PostHog's capture endpoint answered 2xx (it took the batch; ingestion is still
 *   asynchronous on their side);
 * - `retry`: network error, timeout, 408/429 or 5xx, so the same events go again later;
 * - `rejected`: any other 4xx (a malformed batch or a bad token), so retrying can't help.
 */
export type DeliveryResult = { outcome: "accepted" | "retry" | "rejected"; status: number | null };

const DELIVERY_TIMEOUT_MS = 10_000;

/**
 * Sends events to PostHog's batch capture endpoint (`POST {host}/batch/`) directly rather than
 * through posthog-node: the SDK keeps its own in-memory queue and retries, and doesn't say which
 * batch was accepted, while the outbox needs exactly that to delete an event only once delivered.
 * Each event keeps its `uuid` and original `timestamp` on every attempt.
 */
export async function deliverBatch(
  project: TelemetryProject,
  distinctId: string,
  events: readonly OutboxEvent[],
  fetchImpl: FetchLike,
  signal?: AbortSignal
): Promise<DeliveryResult> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, DELIVERY_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${project.host}/batch/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: project.token,
        batch: events.map((event) => ({
          uuid: event.uuid,
          event: event.event,
          distinct_id: distinctId,
          timestamp: new Date(event.occurredAt).toISOString(),
          properties: event.properties
        }))
      }),
      signal: controller.signal
    });
    // The body isn't needed; release the connection.
    await response.body?.cancel().catch(() => undefined);
    if (response.ok) return { outcome: "accepted", status: response.status };
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    return { outcome: retryable ? "retry" : "rejected", status: response.status };
  } catch {
    return { outcome: "retry", status: null };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
