import { beforeEach, describe, expect, it } from "vitest";
import { START_FEN } from "@chaturanga/shared/chess/position";
import {
  usePlayDraftStore,
  withInitialSession,
  withoutInitialSession,
  type PlayDraft,
  type PlayInitialSession
} from "./play-draft-store";

const draft: PlayDraft = {
  engineId: "sf",
  humanColor: "white",
  moveTimeMs: 500,
  depth: null,
  clockPreset: "blitz5_3",
  customMinutes: 10,
  customIncrementSec: 5
};

const initial: PlayInitialSession = {
  rootFen: START_FEN,
  moves: ["e2e4", "e7e5"],
  playerColor: "black",
  label: "My 1...e5 › Open games — 1. e4 e5",
  repertoire: { repertoireId: "r1", chapterId: "c1", nodeId: "n2", capturedPath: "1. e4 e5" }
};

describe("withInitialSession", () => {
  it("takes the repertoire's colour, starts untimed and keeps the other choices", () => {
    const next = withInitialSession(draft, initial);
    expect(next.initialSession).toBe(initial);
    expect(next.humanColor).toBe("black");
    expect(next.clockPreset).toBe("infinite");
    expect(next).toMatchObject({ engineId: "sf", moveTimeMs: 500, depth: null, customMinutes: 10 });
    expect(draft.initialSession).toBeUndefined();
  });
});

describe("withoutInitialSession", () => {
  it("drops the handoff and keeps everything else", () => {
    const next = withoutInitialSession(withInitialSession(draft, initial));
    expect("initialSession" in next).toBe(false);
    expect(next.humanColor).toBe("black");
  });

  it("returns the same draft when there is nothing to clear", () => {
    expect(withoutInitialSession(draft)).toBe(draft);
  });
});

describe("usePlayDraftStore", () => {
  beforeEach(() => usePlayDraftStore.setState({ draft }));

  it("sets and clears the initial session", () => {
    usePlayDraftStore.getState().setInitialSession(initial);
    expect(usePlayDraftStore.getState().draft.initialSession).toBe(initial);
    usePlayDraftStore.getState().clearInitialSession();
    expect(usePlayDraftStore.getState().draft.initialSession).toBeUndefined();
    expect(usePlayDraftStore.getState().draft.engineId).toBe("sf");
  });
});
