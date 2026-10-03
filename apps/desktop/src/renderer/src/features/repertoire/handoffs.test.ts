import { describe, expect, it, vi } from "vitest";
import { START_FEN, statusForFen } from "@chaturanga/shared/chess/position";
import type { LinkGameInput } from "@chaturanga/shared/types/repertoire";
import { addLine, chapterOf, rootNode } from "./__fixtures__/repertoire";
import {
  buildAnalysisSnapshot,
  buildInitialSession,
  chapterPath,
  createLinkOnce,
  gameHasEnded,
  gameFromInitialSession,
  handoffAtEnd,
  repertoireCommandBlocked,
  reviewOpeningAfterFlush,
  type HandoffOrigin,
  type RepertoireCommand
} from "./handoffs";

/** 1. e4 e5 2. Nf3 Nc6 3. Bc4, with a side line 1... c5 and annotations on the main line. */
function italian() {
  const main = addLine([rootNode()], "root", ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"], "m");
  const side = addLine(main.tree, "m0", ["c7c5"], "s");
  const tree = side.tree.map((node) =>
    node.id === "m1"
      ? {
          ...node,
          comment: "The classical reply",
          nags: ["$1"],
          arrows: [{ orig: "g1" as const, dest: "f3" as const, color: "green" as const }],
          highlights: [{ square: "e5" as const, color: "red" as const }]
        }
      : node.id === "root"
        ? { ...node, comment: "Start of the chapter" }
        : node
  );
  return { chapter: chapterOf(tree), mainIds: main.ids };
}

function origin(nodeId: string): HandoffOrigin {
  const { chapter } = italian();
  return { repertoireId: "r1", repertoireName: "My 1.e4", color: "white", chapter, nodeId };
}

describe("chapterPath", () => {
  it("returns the nodes from the root to the node", () => {
    const { chapter } = italian();
    expect(chapterPath(chapter, "m2").map((node) => node.id)).toEqual(["root", "m0", "m1", "m2"]);
  });

  it("falls back to the root for an unknown node", () => {
    const { chapter } = italian();
    expect(chapterPath(chapter, "nope").map((node) => node.id)).toEqual(["root"]);
  });
});

describe("buildAnalysisSnapshot", () => {
  it("copies the route to the selected node as a new unsaved analysis game", () => {
    let next = 0;
    const session = buildAnalysisSnapshot(origin("m2"), () => `n${++next}`);
    expect(session.id).toBeNull();
    expect(session.source).toBe("analysis");
    expect(session.rootFen).toBe(START_FEN);
    expect(session.moveTree.map((node) => node.id)).toEqual(["root", "n1", "n2", "n3"]);
    expect(session.moveTree.map((node) => node.san)).toEqual([null, "e4", "e5", "Nf3"]);
    // Only the route: the side line and later moves stay in the chapter.
    expect(session.moveTree.find((node) => node.san === "c5")).toBeUndefined();
    expect(session.moveTree.map((node) => node.children)).toEqual([["n1"], ["n2"], ["n3"], []]);
    expect(session.moveTree.map((node) => node.parentId)).toEqual([null, "root", "n1", "n2"]);
    expect(session.currentNodeId).toBe("n3");
    expect(session.currentFen).toBe(session.moveTree[3].fenAfter);
    expect(session.moveTree.map((node) => node.ply)).toEqual([0, 1, 2, 3]);
  });

  it("copies comments, NAGs, arrows and highlights along the route", () => {
    const session = buildAnalysisSnapshot(origin("m2"));
    const e5 = session.moveTree[2];
    expect(e5.comment).toBe("The classical reply");
    expect(e5.nags).toEqual(["$1"]);
    expect(e5.arrows).toEqual([{ orig: "g1", dest: "f3", color: "green" }]);
    expect(e5.highlights).toEqual([{ square: "e5", color: "red" }]);
    expect(session.moveTree[0].comment).toBe("Start of the chapter");
    // Copies, not the chapter's own arrays.
    const { chapter } = italian();
    expect(e5.arrows).not.toBe(chapter.tree.find((node) => node.id === "m1")!.arrows);
  });

  it("regenerates node ids (never the chapter's)", () => {
    const session = buildAnalysisSnapshot(origin("m4"));
    const chapterIds = new Set(italian().chapter.tree.map((node) => node.id));
    const moveIds = session.moveTree.slice(1).map((node) => node.id);
    expect(moveIds.some((id) => chapterIds.has(id))).toBe(false);
    expect(new Set(moveIds).size).toBe(moveIds.length);
  });

  it("names the game after the repertoire and chapter and faces the repertoire's colour", () => {
    const session = buildAnalysisSnapshot({ ...origin("m1"), color: "black" });
    expect(session.headers.event).toBe("My 1.e4 › Italian");
    expect(session.headers.result).toBe("*");
    expect(session.headers.orientationHint).toBe("black");
    expect(session.pgn).toContain('[Event "My 1.e4 › Italian"]');
    expect(session.pgn).toContain("1. e4 e5");
  });

  it("is just the root at the chapter's start", () => {
    const session = buildAnalysisSnapshot(origin("root"));
    expect(session.moveTree).toHaveLength(1);
    expect(session.currentNodeId).toBe("root");
  });
});

describe("buildInitialSession", () => {
  it("carries the root, the authored UCI route, the colour and a label", () => {
    const initial = buildInitialSession(origin("m2"));
    expect(initial.rootFen).toBe(START_FEN);
    expect(initial.moves).toEqual(["e2e4", "e7e5", "g1f3"]);
    expect(initial.playerColor).toBe("white");
    expect(initial.label).toBe("My 1.e4 › Italian — 1. e4 e5 2. Nf3");
    expect(initial.repertoire).toEqual({
      repertoireId: "r1",
      chapterId: "c1",
      nodeId: "m2",
      capturedPath: "1. e4 e5 2. Nf3"
    });
  });

  it("names a start at the chapter's root", () => {
    const initial = buildInitialSession(origin("root"));
    expect(initial.moves).toEqual([]);
    expect(initial.label).toBe("My 1.e4 › Italian — starting position");
    expect(initial.repertoire.capturedPath).toBe("Start");
  });
});

describe("gameFromInitialSession", () => {
  it("replays the prefix into a new engine game ending at the handoff position", () => {
    const initial = buildInitialSession(origin("m3"));
    const game = gameFromInitialSession(initial, { event: "Casual game" })!;
    expect(game.id).toBeNull();
    expect(game.source).toBe("engine-game");
    expect(game.headers).toMatchObject({ event: "Casual game", result: "*" });
    expect(game.moveTree.map((node) => node.uci)).toEqual([null, "e2e4", "e7e5", "g1f3", "b8c6"]);
    const last = game.moveTree.find((node) => node.id === game.currentNodeId)!;
    expect(last.uci).toBe("b8c6");
    expect(game.currentFen).toBe(last.fenAfter);
    // White to move after 2... Nc6, with the history in the tree (a single main line).
    expect(statusForFen(game.currentFen).turn).toBe("white");
    expect(game.moveTree.every((node) => node.children.length <= 1)).toBe(true);
    expect(game.pgn).toContain("1. e4 e5 2. Nf3 Nc6");
  });

  it("starts at the root when there is no prefix", () => {
    const game = gameFromInitialSession(buildInitialSession(origin("root")), {})!;
    expect(game.moveTree).toHaveLength(1);
    expect(game.currentFen).toBe(START_FEN);
  });

  it("refuses an illegal prefix", () => {
    const initial = { ...buildInitialSession(origin("m1")), moves: ["e2e4", "e2e4"] };
    expect(gameFromInitialSession(initial, {})).toBeNull();
  });
});

describe("repertoireCommandBlocked", () => {
  const live = { live: { over: false } };
  const finished = { live: { over: true } };
  const none = { live: null };
  const blocking: RepertoireCommand[] = [
    "open-study",
    "open-practice",
    "start-practice",
    "resume-practice",
    "refresh-decision",
    "stage-response",
    "analyze",
    "play-from-here",
    "return-to-repertoire",
    "review-opening"
  ];

  it("blocks every command that replaces the board while a Lichess game is played", () => {
    for (const command of blocking) expect(repertoireCommandBlocked(live, command)).toBe(true);
  });

  it("keeps the hub open during a live game", () => {
    expect(repertoireCommandBlocked(live, "open-hub")).toBe(false);
  });

  it("allows everything with no live game or once it is over", () => {
    for (const command of [...blocking, "open-hub" as const]) {
      expect(repertoireCommandBlocked(none, command)).toBe(false);
      expect(repertoireCommandBlocked(finished, command)).toBe(false);
    }
  });

  it("reads the live state at command time (a newer game blocks again)", () => {
    const state: { live: { over: boolean } | null } = { live: { over: true } };
    expect(repertoireCommandBlocked(state, "analyze")).toBe(false);
    state.live = { over: false };
    expect(repertoireCommandBlocked(state, "analyze")).toBe(true);
  });
});

describe("gameHasEnded", () => {
  const playing = { gameOutcome: null, headers: { result: "*" }, endFen: START_FEN };

  it("is ended by an outcome this session, a decided saved result or a finished position", () => {
    expect(gameHasEnded(playing)).toBe(false);
    expect(gameHasEnded({ ...playing, gameOutcome: { result: "1-0" } })).toBe(true);
    // Reopened after a resignation: the board doesn't show it, the saved result does.
    expect(gameHasEnded({ ...playing, headers: { result: "0-1" } })).toBe(true);
    expect(gameHasEnded({ ...playing, headers: { result: "1/2-1/2" } })).toBe(true);
    const mated = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3";
    expect(gameHasEnded({ ...playing, endFen: mated })).toBe(true);
  });
});

describe("createLinkOnce", () => {
  const input: LinkGameInput = {
    repertoireId: "r1",
    chapterId: "c1",
    gameId: "g1",
    gameNodeId: "n3",
    kind: "played",
    capturedPath: "1. e4 e5 2. Nf3"
  };

  it("links once and ignores repeats", async () => {
    const link = vi.fn(() => Promise.resolve({}));
    const linkOnce = createLinkOnce(link);
    await expect(linkOnce(input)).resolves.toBe(true);
    await expect(linkOnce(input)).resolves.toBe(true);
    expect(link).toHaveBeenCalledTimes(1);
  });

  it("joins a call still running", async () => {
    let resolve!: () => void;
    const link = vi.fn(() => new Promise<void>((done) => (resolve = done)));
    const linkOnce = createLinkOnce(link);
    const first = linkOnce(input);
    const second = linkOnce(input);
    expect(first).toBe(second);
    resolve();
    await expect(first).resolves.toBe(true);
    expect(link).toHaveBeenCalledTimes(1);
  });

  it("links again with a newer stamp that arrives while a link is running", async () => {
    const resolvers: (() => void)[] = [];
    const link = vi.fn(() => new Promise<void>((done) => resolvers.push(done)));
    const linkOnce = createLinkOnce(link);
    const unfinished = linkOnce(input, "*");
    const finished = linkOnce(input, "1-0");
    expect(linkOnce(input, "1-0")).toBe(finished);
    resolvers[0]();
    await expect(unfinished).resolves.toBe(true);
    await vi.waitFor(() => expect(link).toHaveBeenCalledTimes(2));
    resolvers[1]();
    await expect(finished).resolves.toBe(true);
    await expect(linkOnce(input, "1-0")).resolves.toBe(true);
    expect(link).toHaveBeenCalledTimes(2);
  });

  it("tries again after a failure", async () => {
    const link = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({});
    const linkOnce = createLinkOnce(link);
    await expect(linkOnce(input)).resolves.toBe(false);
    await expect(linkOnce(input)).resolves.toBe(true);
    expect(link).toHaveBeenCalledTimes(2);
  });

  it("links another game or kind separately", async () => {
    const link = vi.fn(() => Promise.resolve({}));
    const linkOnce = createLinkOnce(link);
    await linkOnce(input);
    await linkOnce({ ...input, gameId: "g2" });
    await linkOnce({ ...input, kind: "model" });
    expect(link).toHaveBeenCalledTimes(3);
  });

  it("links again when the stamp (the game's result) changes", async () => {
    const link = vi.fn(() => Promise.resolve({}));
    const linkOnce = createLinkOnce(link);
    await linkOnce(input, "*");
    await linkOnce(input, "*");
    await linkOnce(input, "1-0");
    await linkOnce(input, "1-0");
    expect(link).toHaveBeenCalledTimes(2);
  });

  it("links to the repertoire alone when the chapter was deleted", async () => {
    const link = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          "Error invoking remote method 'repertoires:linkGame': Error: Invalid chapterId: not found"
        )
      )
      .mockResolvedValueOnce({});
    const onError = vi.fn();
    const linkOnce = createLinkOnce(link, onError);
    await expect(linkOnce(input)).resolves.toBe(true);
    expect(link).toHaveBeenLastCalledWith({ ...input, chapterId: null });
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports a failure once, not on every retry", async () => {
    const link = vi.fn(() => Promise.reject(new Error("disk full")));
    const onError = vi.fn();
    const linkOnce = createLinkOnce(link, onError);
    await expect(linkOnce(input)).resolves.toBe(false);
    await expect(linkOnce(input)).resolves.toBe(false);
    expect(link).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("disk full");
  });
});

describe("handoffAtEnd", () => {
  it("is true at a mate and false before it", () => {
    const line = addLine([rootNode()], "root", ["f2f3", "e7e5", "g2g4", "d8h4"], "f");
    const chapter = chapterOf(line.tree);
    expect(handoffAtEnd({ chapter, nodeId: line.ids[3] })).toBe(true);
    expect(handoffAtEnd({ chapter, nodeId: line.ids[2] })).toBe(false);
    expect(handoffAtEnd({ chapter, nodeId: "root" })).toBe(false);
  });
});

describe("reviewOpeningAfterFlush", () => {
  const played = {
    repertoireId: "r1",
    chapterId: "c1",
    nodeId: "n2",
    capturedPath: "1. e4 e5",
    gameNodeId: "g2",
    color: "white" as const,
    board: 3,
    gameId: "g1",
    onBoard: true
  };
  const base = {
    request: 4,
    latestRequest: 4,
    liveState: { live: null },
    played,
    gameId: "g1"
  };

  it("goes on for the handoff's game when nothing changed", () => {
    expect(reviewOpeningAfterFlush(base)).toBe("go");
    // The saved game reopened later (no longer the board it started on).
    expect(reviewOpeningAfterFlush({ ...base, played: { ...played, onBoard: false } })).toBe("go");
  });

  it("stops for a newer navigation first", () => {
    expect(
      reviewOpeningAfterFlush({ ...base, latestRequest: 5, liveState: { live: { over: false } } })
    ).toBe("stale");
  });

  it("stops when a Lichess game started while the save was awaited", () => {
    expect(reviewOpeningAfterFlush({ ...base, liveState: { live: { over: false } } })).toBe(
      "blocked"
    );
    expect(reviewOpeningAfterFlush({ ...base, liveState: { live: { over: true } } })).toBe("go");
  });

  it("stops when the board is no longer the handoff's game", () => {
    expect(
      reviewOpeningAfterFlush({ ...base, played: { ...played, onBoard: false }, gameId: "other" })
    ).toBe("gone");
    expect(reviewOpeningAfterFlush({ ...base, played: null })).toBe("gone");
  });
});
