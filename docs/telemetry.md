# Usage analytics (telemetry)

Chaturanga can send **optional, anonymous product analytics** to [PostHog Cloud](https://posthog.com). It is
**off until the user turns it on** (Settings → Usage data) and it never sends game content. This document is
the contract: what is collected, how it is counted, how to configure a build, and how to read the numbers.

Code: `apps/desktop/src/main/telemetry/` (service, outbox, delivery), `packages/shared/src/types/telemetry.ts`
and `packages/shared/src/schemas/telemetry.ts` (the renderer contract), `apps/desktop/src/renderer/src/lib/usage-telemetry.ts`
and `app/useUsageTelemetry.ts` (renderer interactions).

## Principles

- **Main process owns it.** Events are recorded in Electron's main process, which adds identity and common
  metadata. The renderer can only report four fixed interaction shapes over one validated IPC channel
  (`telemetry:track`); unknown events or extra fields are rejected. The renderer's CSP is unchanged
  (`connect-src 'self'`): the renderer never talks to PostHog.
- **Explicit events only.** No autocapture, no session recording, no DOM capture, no PostHog browser SDK.
- **Never on the critical path.** Recording is a local SQLite insert; delivery runs in the background. Every
  telemetry failure is caught and logged as a code: a review, commentary request, import or shutdown never
  fails or waits because of analytics.
- **Pseudonymous.** Events carry `$process_person_profile: false` (no person profiles) and `$geoip_disable: true`
  (no location lookup). There is no account linking.

## Identity: what "a user" means

There is no Chaturanga account, so **a user is an installation profile**:

- `distinct_id` is a random UUID created the first time analytics records something, stored in the profile's
  database (`telemetry_state.installation_id`). It survives app updates.
- A new computer, a new OS user, a deleted profile, or a different `CHATURANGA_USER_DATA_DIR` is a new
  installation. One person on two machines counts twice; two people sharing one profile count once.
- Nothing derives identity from API keys, machine fingerprints, Lichess usernames or hardware.
- `session_id` is a random UUID per app launch.
- `game_ref` identifies a library game: an HMAC of the local game id with a random per-installation key, so it is
  stable for that installation, is not the local id, and can't be linked across installations. "Distinct games"
  means distinct library records: importing the same PGN twice is two games.
- `review_id` is the review operation's UUID. It is now saved with the review (`GameReview.reviewId`), so a review
  opened later is attributable. Reviews saved before this change have none (`legacy_review: true`).

"Observed" totals exclude everyone who never opted in, who is permanently offline, or whose events expired
locally (see limits). Existing users' first event after this change is *first observed*, not a new install;
no historical library is uploaded. Lifetime totals are bounded by PostHog's data retention (1 year on the free
plan, 7 years on pay-as-you-go).

## Collection controls

| Control | Effect |
| --- | --- |
| Settings → Usage data (`usageAnalyticsEnabled`) | Off by default. Off: nothing is recorded or sent, and **events not sent yet are deleted**. On again: collection resumes; nothing old comes back. |
| `CHATURANGA_TELEMETRY_ENABLED=false` (or `0`) | Hard disable, whatever the setting says. Queued events are deleted at startup. |
| Development, tests, automation | Never delivered: unpackaged builds, Vitest/`NODE_ENV=test` and runs with `CHATURANGA_USER_DATA_DIR` (UI automation) report `development`. `CHATURANGA_TELEMETRY_DEV=1` opts such a run in (use a separate test project); its events carry `release_channel: "development"`. |
| No project configured | A build without a token/host can't send anything (Settings says so). |

To have already-collected data removed, delete the installation's person/events in PostHog by `distinct_id`
(the id is in the profile's `chaturanga.sqlite`, table `telemetry_state`).

## Never collected

PGN or FEN, moves, player names, event/site headers, game or match URLs, Lichess usernames/ids/tokens, file
paths, engine names or paths (only `engine_family`: `stockfish` / `lc0` / `other`), model ids other than the
default (only `model_vendor`, or `custom`), API keys, prompts, generated prose, provider response bodies, and
error messages (only coded failures). The renderer contract is strict-schema validated in main; tests check
that content-bearing fields are rejected and that recorded payloads contain none of it.

## Configuration

The build reads two **public** values (electron-vite `MAIN_VITE_*` build-time variables):

| Variable | Value |
| --- | --- |
| `MAIN_VITE_POSTHOG_PROJECT_TOKEN` | The project's ingest token (`phc_…`, Project settings → General). It can only send events. **Never** use a personal API key. |
| `MAIN_VITE_POSTHOG_HOST` | The project's region ingest host: `https://eu.i.posthog.com` (EU Cloud) or `https://us.i.posthog.com` (US Cloud). No region is assumed; it must be https. |

- **Releases**: `.github/workflows/release.yml` passes repository variables `POSTHOG_PROJECT_TOKEN` and
  `POSTHOG_HOST` to the build step (Settings → Secrets and variables → Actions → Variables). CI builds (`ci.yml`)
  have neither, so they can't send.
- **Local testing**: build with the variables set and opt the run in, e.g.
  `MAIN_VITE_POSTHOG_PROJECT_TOKEN=phc_… MAIN_VITE_POSTHOG_HOST=https://eu.i.posthog.com pnpm --filter @chaturanga/desktop build`,
  then run with `CHATURANGA_TELEMETRY_DEV=1`. Prefer a separate PostHog project for this; otherwise filter on
  `release_channel != 'development'`.
- Recommended project settings: "Discard client IP data" on; set the project timezone to UTC (reports below are
  UTC); a billing limit.

## Delivery, offline and shutdown

- **Outbox**: every event is written to `telemetry_outbox` (SQLite, migration 5) with its UUID and occurrence
  time, and only deleted after PostHog's capture endpoint (`POST {host}/batch/`) answers 2xx. Offline events
  survive restarts and are sent later with their **original `uuid` and `timestamp`**, so delayed uploads land on
  the day they happened.
- **Why not posthog-node**: the SDK keeps its own in-memory queue, retries on its own schedule, drops the oldest
  events when full, and doesn't report which batch was accepted. The outbox needs to delete exactly what was
  acknowledged, so delivery is a small explicit HTTP adapter (`telemetry/transport.ts`) over Electron's network
  stack (system proxy settings apply).
- **Draining** is serialized (one drain at a time; concurrent requests join it), in batches of 50, up to 10
  batches per drain, 5 s after an event and every 60 s.
- **Retries**: network errors, timeouts (10 s), 408, 429 and 5xx retry with exponential backoff
  (30 s × 2^attempts, capped at 1 h, ×0.5–1.5 jitter). Other 4xx drop the batch. A batch is given up after 12
  attempts.
- **Limits**: at most 5,000 queued events (oldest dropped) and 30 days of age; drops are logged locally.
- **Duplicates**: a batch whose response was lost is resent with the same UUIDs. PostHog deduplicates events with
  the same `uuid`, `event`, `distinct_id` and day, but asynchronously and not as a guarantee, so delivery is
  at-least-once, not exactly-once. Counting distinct domain ids (`review_id`, `request_id`) is robust to
  duplicates either way.
- **Shutdown**: after downloads stop and **before the database closes**, analytics gets one bounded drain
  (1.5 s); anything unsent stays queued for the next launch, and nothing touches the database afterwards. An
  update install runs the same shutdown. A review cancelled by quitting may not be recorded.

## Events

Common properties on every event: `schema_version`, `session_id`, `app_version`, `release_channel`
(`stable` / `beta` / `development`), `platform`, `arch`, `$lib`, `$process_person_profile: false`,
`$geoip_disable: true`. A property that isn't known is **omitted** (never sent as 0 or null).

### Activity and activation

| Event | When | Properties |
| --- | --- | --- |
| `user_active` | First meaningful foreground action of a UTC day (at most once per day per installation) | `kind` (`study` / `play` / `puzzle`), `utc_day` |
| `activation_milestone` | Once per installation per step | `milestone` (`engine_ready`, `game_imported`, `review_completed`, `review_studied`, `commentary_viewed`), `existing` (found already set up at startup) |
| `game_imported` | A PGN import (user action) or a Lichess sync that added games | `source` (`pgn` / `lichess`), `games` |

**Meaningful activity** is: a move made or stepped through in a game, review, engine/online game or puzzle
within 4 s of the user's own key or pointer press while the window is focused and visible; importing a PGN;
starting a review; opening or studying a review; viewing commentary; pressing Retry on commentary. It
excludes app start (including restoring the last game), background engine replies, Lichess auto-sync,
update checks, provider retries and anything that completes in the background.

### Review lifecycle (main process, `ipc/review-handler.ts`)

One `review_started` and exactly one terminal event per operation.

| Event | When | Properties |
| --- | --- | --- |
| `review_started` | Analyze pressed (a new operation) | `review_id`, `game_ref`, `ply_count`, `ply_bucket`, `engine_family`, `search_ms`, `multipv`, `maia_levels` |
| `review_completed` | The engine pass finished | same + `duration_ms` (monotonic) |
| `review_cancelled` | Cancelled (by the user, navigation or quitting) | same + `duration_ms`, `moves_done` |
| `review_failed` | Any other error | same + `duration_ms`, `moves_done`, `error_code` (`engine_not_found`, `engine_unavailable`, `engine_exited`, `timeout`, `unknown`) |
| `review_opened` | A **saved** review is shown on the Game review page (once per session per review) | `review_id`, `game_ref`, `legacy_review` |
| `review_studied` | The user selected **3 distinct reviewed moves** of a review in one session (once per session per review) | `review_id`, `game_ref`, `legacy_review` |

Re-analyzing a game three times is three `review_started`/`review_completed` operations and one `game_ref`.
Loading a saved review, autosaves, IPC broadcasts and React renders never produce a completion.

### Commentary (main: `commentary:generate`; renderer: views)

Commentary is on demand: once a review is ready and the Commentary tab is visible, the move the user settles on
is requested alone (debounced), cached per move in the review, and saved with the game. A failed prose
validation triggers one corrective retry.

| Event | When | Properties |
| --- | --- | --- |
| `commentary_requested` | One **logical** request for one move | `request_id`, `review_id`, `game_ref`, `ply`, `trigger` (`auto` / `user_retry`), `detail`, `model_vendor`, `model_is_default` |
| `commentary_provider_attempt` | Each actual HTTP attempt | `request_id`, `attempt`, `reason` (`initial` / `validation_retry`), `result` (`accepted`, `validation_failed`, or a failure code), `http_status`, `latency_ms`, `prompt_tokens`, `completion_tokens`, `cost_usd` (when OpenRouter reported them) |
| `commentary_completed` / `commentary_failed` | The single terminal outcome per logical request | `request_id`, `ply`, `attempts`, `validation_retried`, `first_attempt_valid`, `latency_ms`, `error_code` (failed), usage totals over **all answered attempts** (`prompt_tokens_total`, `completion_tokens_total`, `cost_usd_total`) and `tokens_complete` / `cost_complete` (false when any answered attempt didn't report them; missing totals are omitted, never 0) |
| `commentary_viewed` | An explanation stayed in view **2 s** with the Commentary tab visible and the window focused (once per session, review and move) | `review_id`, `game_ref`, `ply`, `served_from_cache` |
| `commentary_session_started` | The first qualified view for a game in a session | `review_id`, `game_ref`, `legacy_review` |

Failure codes: `no_api_key`, `unreadable_key`, `invalid_key`, `insufficient_credits`, `invalid_model`,
`rate_limited`, `provider_error`, `network`, `timeout`, `empty_response`, `validation_failed`.

- A user's Retry is a new logical request with `trigger: user_retry`; the automatic validation retry is a second
  *attempt* of the same request.
- A batch with mixed results produces one terminal event per move.
- Reading a cached explanation is a `commentary_viewed` with `served_from_cache: true` and **no** request or
  attempt. A result that arrives after the user moved to another move (or hid the tab / left the window) is
  generated (`commentary_completed`) but not viewed.
- Two seconds in view is a proxy for consumption, not proof of reading.
- Token/cost totals are the user's own OpenRouter spend (BYOK), not Chaturanga's cost; failed or unreported
  attempts make observed spend a lower bound.

## Example reports (PostHog SQL / insights)

All examples exclude development traffic; daily numbers assume the project timezone is UTC (or wrap
`timestamp` in `toTimeZone(timestamp, 'UTC')`).

```sql
-- Total observed installations, and first-observed cohort by week
SELECT count(DISTINCT distinct_id) FROM events WHERE properties.release_channel != 'development';
SELECT toStartOfWeek(first_seen) AS cohort, count() FROM (
  SELECT distinct_id, min(timestamp) AS first_seen FROM events
  WHERE properties.release_channel != 'development' GROUP BY distinct_id
) GROUP BY cohort ORDER BY cohort;

-- Daily active installations (UTC)
SELECT toDate(timestamp) AS day, count(DISTINCT distinct_id) AS dau
FROM events WHERE event = 'user_active' AND properties.release_channel != 'development'
GROUP BY day ORDER BY day;

-- Review operations, distinct reviewed games, and per installation
SELECT count(DISTINCT properties.review_id) AS review_operations,
       uniqExact(distinct_id, properties.game_ref) AS distinct_games_reviewed
FROM events WHERE event = 'review_completed' AND properties.release_channel != 'development';
SELECT distinct_id, count(DISTINCT properties.review_id) AS reviews,
       count(DISTINCT properties.game_ref) AS games
FROM events WHERE event = 'review_completed' GROUP BY distinct_id ORDER BY reviews DESC;

-- Review completion / cancellation / failure rates and latency
SELECT event, count(DISTINCT properties.review_id) AS operations,
       quantile(0.5)(toFloat(properties.duration_ms)) AS p50_ms,
       quantile(0.95)(toFloat(properties.duration_ms)) AS p95_ms
FROM events WHERE event IN ('review_started', 'review_completed', 'review_cancelled', 'review_failed')
GROUP BY event;

-- Commentary: viewing sessions, generation requests (by trigger), adoption among reviewers
SELECT count() FROM events WHERE event = 'commentary_session_started';
SELECT properties.trigger, count(DISTINCT properties.request_id) FROM events
WHERE event = 'commentary_requested' GROUP BY properties.trigger;
SELECT countIf(viewed) / count() AS adoption FROM (
  SELECT distinct_id, max(event = 'commentary_viewed') AS viewed FROM events
  WHERE event IN ('commentary_viewed', 'review_completed', 'review_opened') GROUP BY distinct_id
);

-- Commentary reliability, latency, retries, cost and cache use
SELECT countIf(event = 'commentary_completed') / count() AS success_rate,
       avgIf(toFloat(properties.first_attempt_valid = 'true'), event = 'commentary_completed') AS first_attempt_valid_rate,
       avg(toFloat(properties.attempts)) AS attempts_per_request,
       quantile(0.5)(toFloat(properties.latency_ms)) AS p50_ms,
       sumIf(toFloat(properties.cost_usd_total), properties.cost_complete = 'true') AS reported_cost_usd
FROM events WHERE event IN ('commentary_completed', 'commentary_failed');
SELECT properties.error_code, count() FROM events WHERE event = 'commentary_failed' GROUP BY properties.error_code;
SELECT avg(toFloat(properties.served_from_cache = 'true')) AS cached_share FROM events WHERE event = 'commentary_viewed';
```

Insights to build in the PostHog UI:

- **Activation funnel**: `activation_milestone` steps filtered by `milestone` = `engine_ready` →
  `game_imported` → `review_completed` → `review_studied` → `commentary_viewed` (conversion and time to convert).
- **D7 / weekly retention**: Retention insight, start event `user_active` (or first `activation_milestone`),
  return event `user_active`, period day (D1/D7/D30) or week.
- **Weekly studying installations**: Trends, `review_studied` + `commentary_viewed`, unique users, weekly.

## Limits and follow-ups

- Users are installations, not people (see Identity). Opted-out and permanently offline installations are never
  observed.
- Delivery is at-least-once; PostHog's deduplication by UUID is eventual.
- Studying a review is measured on the Game review page; stepping through a review from elsewhere counts as
  activity but not as `review_studied`.
- Not in this change: crash reporting (e.g. Sentry), tracing, accounts, attribution, experiments, a feedback
  control.
