import { describe, expect, it } from "vitest";
import { parseCommentaryRequestContext } from "@chaturanga/shared/schemas/telemetry";
import { parseRendererEvent, recordRendererEvent } from "./renderer-events";
import { makeService, telemetryDatabase } from "./__fixtures__/telemetry-fixtures";
import { SESSION_IDLE_MS } from "./session";

type Recorded = { event: string; [property: string]: unknown };

const REVIEW = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

function recorded(db: ReturnType<typeof telemetryDatabase>) {
  return (
    db.prepare("SELECT event, payload_json FROM telemetry_outbox ORDER BY rowid").all() as {
      event: string;
      payload_json: string;
    }[]
  ).map(
    (row): Recorded => ({
      event: row.event,
      ...(JSON.parse(row.payload_json) as Record<string, unknown>)
    })
  );
}

function outboxTimes(db: ReturnType<typeof telemetryDatabase>): number[] {
  return (
    db.prepare("SELECT occurred_at FROM telemetry_outbox").all() as { occurred_at: number }[]
  ).map((row) => row.occurred_at);
}

describe("renderer telemetry events: validation", () => {
  it("accepts the allowlisted shapes", () => {
    expect(parseRendererEvent({ type: "activity", kind: "study" })).toEqual({
      type: "activity",
      kind: "study"
    });
    expect(
      parseRendererEvent({
        type: "commentary_viewed",
        reviewId: REVIEW,
        gameId: "V1StGXR8_Z5jdHi6B-myT",
        ply: 12,
        source: "cached"
      })
    ).toMatchObject({
      ply: 12
    });
    expect(parseRendererEvent({ type: "review_opened", reviewId: null, gameId: null }).type).toBe(
      "review_opened"
    );
  });

  it("rejects unknown events, extra (content) fields and malformed ids", () => {
    const bad = [
      { type: "page_view", url: "x" },
      { type: "activity", kind: "browse" },
      // Strict shapes: content can't ride along on an allowed event.
      {
        type: "activity",
        kind: "study",
        fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
      },
      { type: "review_opened", reviewId: REVIEW, gameId: "g1", white: "Magnus Carlsen" },
      {
        type: "commentary_viewed",
        reviewId: REVIEW,
        gameId: null,
        ply: 3,
        source: "cached",
        prose: "Nice move"
      },
      { type: "review_opened", reviewId: "not-a-uuid", gameId: null },
      { type: "review_opened", reviewId: null, gameId: "/Users/me/games/x.pgn" },
      { type: "commentary_viewed", reviewId: null, gameId: null, ply: -1, source: "fresh" },
      { type: "commentary_viewed", reviewId: null, gameId: null, ply: 3, source: "provider" },
      "activity",
      null
    ];
    for (const value of bad)
      expect(() => parseRendererEvent(value)).toThrow(
        expect.objectContaining({ name: "ZodError" })
      );
  });

  it("drops a malformed commentary context instead of trusting it", () => {
    expect(
      parseCommentaryRequestContext({ reviewId: REVIEW, gameId: "g1", trigger: "user_retry" })
    ).toEqual({
      reviewId: REVIEW,
      gameId: "g1",
      trigger: "user_retry"
    });
    expect(
      parseCommentaryRequestContext({
        reviewId: REVIEW,
        gameId: "g1",
        trigger: "auto",
        prompt: "…"
      })
    ).toBeNull();
    expect(parseCommentaryRequestContext(undefined)).toBeNull();
  });
});

describe("renderer telemetry events: counting", () => {
  it("a cached explanation counts as viewed once per review and move, with no generation", () => {
    const db = telemetryDatabase();
    const service = makeService({ db });
    service.start();
    const view = (ply: number) =>
      recordRendererEvent(service, {
        type: "commentary_viewed",
        reviewId: REVIEW,
        gameId: "g1",
        ply,
        source: "cached"
      });
    view(5);
    view(5);
    view(6);
    const events = recorded(db);
    expect(
      events
        .filter((event) => event.event === "commentary_viewed")
        .map((event) => [event.ply, event.served_from_cache])
    ).toEqual([
      [5, true],
      [6, true]
    ]);
    // One commentary session for the game; no request or provider attempt for cached views.
    expect(events.filter((event) => event.event === "commentary_session_started")).toHaveLength(1);
    expect(events.some((event) => String(event.event).startsWith("commentary_requested"))).toBe(
      false
    );
    expect(
      events
        .filter((event) => event.event === "activation_milestone")
        .map((event) => event.milestone)
    ).toEqual(["commentary_viewed"]);
    // Game ids are pseudonymised before anything is stored.
    expect(JSON.stringify(events)).not.toContain('"g1"');
  });

  it("opening and studying a saved review are counted once per session, never as completions", () => {
    const db = telemetryDatabase();
    const service = makeService({ db });
    service.start();
    for (let index = 0; index < 3; index += 1) {
      recordRendererEvent(service, { type: "review_opened", reviewId: REVIEW, gameId: "g1" });
      recordRendererEvent(service, { type: "review_studied", reviewId: REVIEW, gameId: "g1" });
    }
    // A legacy review (saved before reviews had ids) is told apart by its game.
    recordRendererEvent(service, { type: "review_opened", reviewId: null, gameId: "g2" });
    const events = recorded(db).map((event) => event.event);
    expect(events.filter((event) => event === "review_opened")).toHaveLength(2);
    expect(events.filter((event) => event === "review_studied")).toHaveLength(1);
    expect(events).not.toContain("review_completed");
    expect(
      recorded(db).find((event) => event.event === "review_opened" && event.legacy_review)
    ).toBeTruthy();
  });

  it("a new session (after inactivity) counts the same review and explanation again", () => {
    const db = telemetryDatabase();
    let now = Date.UTC(2026, 9, 2, 9, 30);
    const service = makeService({ db, now: () => now });
    service.start();
    const all = () => {
      recordRendererEvent(service, { type: "review_opened", reviewId: REVIEW, gameId: "g1" });
      recordRendererEvent(service, { type: "review_studied", reviewId: REVIEW, gameId: "g1" });
      recordRendererEvent(service, {
        type: "commentary_viewed",
        reviewId: REVIEW,
        gameId: "g1",
        ply: 5,
        source: "cached"
      });
    };
    all();
    now += 60_000;
    all();
    now += SESSION_IDLE_MS + 60_000;
    all();
    const events = recorded(db);
    const sessionsOf = (name: string) =>
      events.filter((event) => event.event === name).map((event) => event.$session_id);
    for (const name of [
      "review_opened",
      "review_studied",
      "commentary_viewed",
      "commentary_session_started"
    ]) {
      const sessions = sessionsOf(name);
      expect(sessions).toHaveLength(2);
      expect(sessions[0]).not.toBe(sessions[1]);
    }
  });

  it("the check and the event share a timestamp, so the boundary can't double-count", () => {
    const db = telemetryDatabase();
    let now = Date.UTC(2026, 9, 2, 9, 30);
    // Every read of the clock moves it on by 1 ms.
    const service = makeService({ db, now: () => (now += 1) });
    service.start();
    const OTHER = "9f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
    recordRendererEvent(service, { type: "review_opened", reviewId: OTHER, gameId: "g2" });
    const lastEventAt = Math.max(...outboxTimes(db));
    // The next read lands 1 ms before the session would end, the one after it on the boundary.
    now = lastEventAt + SESSION_IDLE_MS - 2;
    recordRendererEvent(service, { type: "review_opened", reviewId: REVIEW, gameId: "g1" });
    recordRendererEvent(service, { type: "review_opened", reviewId: REVIEW, gameId: "g1" });
    const opened = recorded(db).filter(
      (event) => event.event === "review_opened" && event.review_id === REVIEW
    );
    expect(opened).toHaveLength(1);
  });

  it("is ignored entirely while collection is off", () => {
    const db = telemetryDatabase();
    const service = makeService({ db, consent: () => false });
    service.start();
    recordRendererEvent(service, { type: "activity", kind: "play" });
    recordRendererEvent(service, { type: "review_opened", reviewId: REVIEW, gameId: "g1" });
    expect(recorded(db)).toEqual([]);
  });
});
