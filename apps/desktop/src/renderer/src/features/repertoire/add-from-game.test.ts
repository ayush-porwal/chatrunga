import { describe, expect, it } from "vitest";
import { addMoveNode, createEmptyGame } from "@chaturanga/shared/chess/pgn";
import { applySan, START_FEN } from "@chaturanga/shared/chess/position";
import type { MoveNode, SavedGame } from "@chaturanga/shared/types/chess";
import type { AddFromGameInput } from "@chaturanga/shared/types/repertoire";
import { useAppNoticeStore } from "../../stores/app-notice-store";
import { useAddToRepertoireStore } from "../../stores/add-to-repertoire-store";
import {
  EMPTY_POLICY_STATE,
  addInputBaseKey,
  buildScope,
  conflictText,
  defaultChapterKind,
  defaultChapterTitle,
  defaultRepertoireId,
  gameLinkLabel,
  missingGameNote,
  newRepertoireRootFen,
  hashAddInput,
  hasMoves,
  headerValue,
  initialScopeChoice,
  policyFor,
  policyReducer,
  scopeNodeId,
  scopeOptions,
  sourceFromBoard,
  sourceFromSavedGame,
  sourceHeaders
} from "./add-from-game";

/** A game tree from SAN moves along one line, plus a side variation from the root. */
function gameTree(line: string[], rootVariation: string[] = []): MoveNode[] {
  let tree = createEmptyGame().moveTree;
  const play = (moves: string[]) => {
    let parent = tree[0]!;
    for (const san of moves) {
      const moved = applySan(parent.fenAfter, san);
      if (!moved) throw new Error(`illegal ${san}`);
      const result = addMoveNode(tree, parent.id, moved.san, moved.uci, parent.fenAfter, moved.fen);
      tree = result.moveTree;
      parent = result.node;
    }
  };
  play(line);
  play(rootVariation);
  return tree;
}

function nodeBySan(tree: MoveNode[], san: string): MoveNode {
  const node = tree.find((item) => item.san === san);
  if (!node) throw new Error(`no ${san}`);
  return node;
}

describe("source extraction", () => {
  it("maps headers to PGN tag names and keeps only non-empty strings", () => {
    expect(
      sourceHeaders({
        white: "Carlsen",
        black: "Nakamura",
        event: "",
        site: null,
        eco: "C50",
        utcDate: "2024.01.01",
        whiteElo: "2830",
        orientationHint: "black",
        result: "1-0"
      })
    ).toEqual({
      White: "Carlsen",
      Black: "Nakamura",
      ECO: "C50",
      UTCDate: "2024.01.01",
      WhiteElo: "2830",
      Result: "1-0"
    });
    expect(sourceHeaders(null)).toEqual({});
  });

  it("builds a source from the board, the selected move as provenance", () => {
    const tree = gameTree(["e4", "e5", "Nf3"]);
    const nf3 = nodeBySan(tree, "Nf3");
    const source = sourceFromBoard({
      gameId: null,
      headers: { white: "A", black: null },
      rootFen: START_FEN,
      moveTree: tree,
      currentNodeId: nf3.id
    });
    expect(source).toEqual({
      gameId: null,
      headers: { White: "A" },
      rootFen: START_FEN,
      tree,
      nodeId: nf3.id
    });
    expect(
      sourceFromBoard({
        gameId: "g1",
        headers: {},
        rootFen: "",
        moveTree: tree,
        currentNodeId: "root"
      })
    ).toMatchObject({ gameId: "g1", rootFen: START_FEN, nodeId: null });
  });

  it("builds a source from a saved game without a node", () => {
    const tree = gameTree(["d4"]);
    const saved = {
      id: "g2",
      source: "pgn",
      white: "W",
      black: "B",
      event: "Open",
      site: null,
      date: null,
      round: null,
      result: "*",
      headers: { white: "W", black: "B", event: "Open" },
      initialFen: null,
      currentFen: tree[1]!.fenAfter,
      currentNodeId: tree[1]!.id,
      pgn: "1. d4 *",
      moveTree: tree,
      review: null,
      reviews: []
    } as unknown as SavedGame;
    const source = sourceFromSavedGame(saved);
    expect(source.gameId).toBe("g2");
    expect(source.nodeId).toBeNull();
    expect(source.headers).toMatchObject({ White: "W", Black: "B", Event: "Open", Result: "*" });
    expect(source.tree.map((node) => node.san)).toEqual([null, "d4"]);
    expect(source.rootFen).toBe(START_FEN);
  });

  it("knows whether a tree has moves", () => {
    expect(hasMoves(createEmptyGame().moveTree)).toBe(false);
    expect(hasMoves(gameTree(["e4"]))).toBe(true);
  });
});

describe("labels and destination defaults", () => {
  it("reads headers whatever their case", () => {
    expect(headerValue({ white: " Tal " }, "White")).toBe("Tal");
    expect(headerValue({}, "Black")).toBe("");
  });

  it("proposes a chapter title from the players, else the event", () => {
    expect(defaultChapterTitle({ White: "Tal", Black: "Botvinnik", Event: "WCh" })).toBe(
      "Tal – Botvinnik"
    );
    expect(defaultChapterTitle({ Black: "Botvinnik" })).toBe("? – Botvinnik");
    expect(defaultChapterTitle({ Event: "Casual" })).toBe("Casual");
    expect(defaultChapterTitle({})).toBe("Game");
  });

  it("labels a linked game with its event", () => {
    const at = new Date(2026, 9, 3).getTime();
    expect(gameLinkLabel({ White: "Tal", Black: "Botvinnik", Event: "WCh" }, at)).toBe(
      "Tal – Botvinnik (WCh)"
    );
    expect(gameLinkLabel({ white: "Tal", black: "Botvinnik", event: "?" }, at)).toBe(
      "Tal – Botvinnik"
    );
    expect(gameLinkLabel({ Event: "Training" }, at)).toBe("Training");
    // An analysis board game without tags: the date the link was made.
    const date = new Date(at).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
    expect(gameLinkLabel({}, at)).toBe(`Analysis board · ${date}`);
    expect(gameLinkLabel({ Event: "?" }, at)).toBe(`Analysis board · ${date}`);
  });

  it("tells a board game never saved from a library game deleted since", () => {
    expect(missingGameNote({ unsaved: true })).toBe("(from the Analyze board, never saved)");
    expect(missingGameNote({ unsaved: false })).toBe("(game no longer in library)");
  });

  it("starts a new repertoire from the current game only on the plain Create path", () => {
    const later = applySan(START_FEN, "e4")!.fen;
    expect(newRepertoireRootFen("game", "", later, "study")).toBe(later);
    expect(newRepertoireRootFen("game", "", later, "import")).toBeNull();
    expect(newRepertoireRootFen("game", "", START_FEN, "study")).toBeNull();
    expect(newRepertoireRootFen("game", "", null, "study")).toBeNull();
    expect(newRepertoireRootFen("fen", ` ${later} `, null, "import")).toBe(later);
    expect(newRepertoireRootFen("initial", "", later, "study")).toBeNull();
  });

  it("selects the first candidate that is still an active repertoire, never guessing", () => {
    const list = [
      { id: "a", archivedAt: null },
      { id: "b", archivedAt: 5 },
      { id: "c", archivedAt: null }
    ];
    expect(defaultRepertoireId(list, ["b", "c", "a"])).toBe("c");
    expect(defaultRepertoireId(list, [null, undefined, "gone"])).toBeNull();
    expect(defaultRepertoireId([], ["a"])).toBeNull();
  });

  it("defaults a whole game to reference and an excerpt to opening", () => {
    expect(defaultChapterKind("whole-game")).toBe("reference");
    expect(defaultChapterKind("path")).toBe("opening");
    expect(defaultChapterKind("subtree")).toBe("opening");
  });
});

describe("scope", () => {
  const tree = gameTree(["e4", "e5", "Nf3"], ["d4"]);
  const e5 = nodeBySan(tree, "e5");

  it("offers the line and branch only at a selected move", () => {
    const atMove = scopeOptions(tree, e5.id);
    expect(atMove.map((option) => [option.value, option.label, option.disabled])).toEqual([
      ["path", "Line to here", false],
      ["subtree", "This branch", false],
      ["whole-game", "Whole game", false]
    ]);
    for (const nodeId of ["root", null, "unknown"]) {
      expect(
        scopeOptions(tree, nodeId)
          .filter((option) => !option.disabled)
          .map((o) => o.value)
      ).toEqual(["whole-game"]);
    }
    expect(scopeOptions(createEmptyGame().moveTree, null).every((option) => option.disabled)).toBe(
      true
    );
  });

  it("starts with the hinted scope when it's available, else the whole game", () => {
    const hint = { kind: "path", toNodeId: e5.id } as const;
    expect(initialScopeChoice(hint, scopeOptions(tree, e5.id))).toBe("path");
    expect(initialScopeChoice(hint, scopeOptions(tree, "root"))).toBe("whole-game");
    expect(initialScopeChoice({ kind: "whole-game" }, scopeOptions(tree, e5.id))).toBe(
      "whole-game"
    );
  });

  it("builds the scope to send", () => {
    expect(scopeNodeId({ kind: "path", toNodeId: "n" })).toBe("n");
    expect(scopeNodeId({ kind: "subtree", fromNodeId: "m", root: "original" })).toBe("m");
    expect(scopeNodeId({ kind: "whole-game" })).toBeNull();
    expect(buildScope("path", "n", "original")).toEqual({ kind: "path", toNodeId: "n" });
    expect(buildScope("subtree", "n", "standalone")).toEqual({
      kind: "subtree",
      fromNodeId: "n",
      root: "standalone"
    });
    expect(buildScope("path", null, "original")).toEqual({ kind: "whole-game" });
    expect(buildScope("whole-game", "n", "original")).toEqual({ kind: "whole-game" });
  });
});

describe("policy", () => {
  const move = (nodeId: string) => ({ nodeId, san: "x", uci: "a1a2", ply: 1, path: "" });
  const preview = {
    defaultPolicy: { includedNodeIds: ["a", "b"], coveredNodeIds: ["r1"] },
    opponentMoves: [move("r1"), move("r2")]
  };
  const initial = policyReducer(EMPTY_POLICY_STATE, { type: "init", baseKey: "k", preview });

  it("initialises from the defaults once per base key", () => {
    expect(policyFor(initial, "k")).toEqual({
      includedNodeIds: ["a", "b"],
      coveredNodeIds: ["r1", "r2"]
    });
    const toggled = policyReducer(initial, { type: "toggle", nodeId: "a" });
    // A later preview of the same base keeps the user's choice.
    expect(policyReducer(toggled, { type: "init", baseKey: "k", preview })).toBe(toggled);
    // A new scope or destination proposes again.
    const again = policyReducer(toggled, { type: "init", baseKey: "k2", preview });
    expect(policyFor(again, "k2")?.includedNodeIds).toEqual(["a", "b"]);
  });

  it("covers the defaults even when they aren't listed as opponent moves", () => {
    const state = policyReducer(EMPTY_POLICY_STATE, {
      type: "init",
      baseKey: "k",
      preview: { ...preview, opponentMoves: [move("r2")] }
    });
    expect(policyFor(state, "k")?.coveredNodeIds).toEqual(["r1", "r2"]);
  });

  it("toggles own moves on and off", () => {
    let state = policyReducer(initial, { type: "toggle", nodeId: "a" });
    expect(policyFor(state, "k")?.includedNodeIds).toEqual(["b"]);
    state = policyReducer(state, { type: "toggle", nodeId: "c" });
    state = policyReducer(state, { type: "toggle", nodeId: "a" });
    expect(policyFor(state, "k")?.includedNodeIds).toEqual(["a", "b", "c"]);
  });

  it("covers opponent replies only with the switch on, and remembers the switch", () => {
    let state = policyReducer(initial, { type: "set-cover", on: false });
    expect(policyFor(state, "k")?.coveredNodeIds).toEqual([]);
    state = policyReducer(state, { type: "init", baseKey: "k2", preview });
    expect(state.coverReplies).toBe(false);
    state = policyReducer(state, { type: "set-cover", on: true });
    expect(policyFor(state, "k2")?.coveredNodeIds).toEqual(["r1", "r2"]);
    expect(policyReducer(state, { type: "reset" })).toMatchObject({
      baseKey: null,
      coverReplies: true
    });
  });

  it("asks for the defaults (null) for a base it wasn't initialised from", () => {
    expect(policyFor(initial, "other")).toBeNull();
    expect(policyFor(EMPTY_POLICY_STATE, "k")).toBeNull();
  });
});

describe("input hashing", () => {
  const tree = gameTree(["e4", "e5"]);
  const input: AddFromGameInput = {
    repertoireId: "r",
    expectedRevision: 3,
    destination: { kind: "new-chapter", title: "Tal – Botvinnik", chapterKind: "reference" },
    source: { gameId: "g", headers: { White: "Tal" }, rootFen: START_FEN, tree, nodeId: null },
    scope: { kind: "whole-game" },
    policy: { includedNodeIds: ["a", "b"], coveredNodeIds: [] }
  };

  it("is stable and ignores policy order and the provenance node", () => {
    expect(hashAddInput(input)).toBe(hashAddInput({ ...input }));
    expect(
      hashAddInput({ ...input, policy: { includedNodeIds: ["b", "a"], coveredNodeIds: [] } })
    ).toBe(hashAddInput(input));
    expect(hashAddInput({ ...input, source: { ...input.source, nodeId: tree[1]!.id } })).toBe(
      hashAddInput(input)
    );
  });

  it("changes with the policy, title, revision, scope and moves", () => {
    const base = hashAddInput(input);
    expect(
      hashAddInput({ ...input, policy: { includedNodeIds: ["a"], coveredNodeIds: [] } })
    ).not.toBe(base);
    // Asking for the defaults is not the same as an empty policy.
    const empty = hashAddInput({ ...input, policy: { includedNodeIds: [], coveredNodeIds: [] } });
    expect(hashAddInput({ ...input, policy: null })).not.toBe(empty);
    expect(
      hashAddInput({ ...input, destination: { ...input.destination, title: "Other" } as never })
    ).not.toBe(base);
    expect(hashAddInput({ ...input, expectedRevision: 4 })).not.toBe(base);
    expect(hashAddInput({ ...input, scope: { kind: "path", toNodeId: tree[1]!.id } })).not.toBe(
      base
    );
    expect(
      hashAddInput({ ...input, source: { ...input.source, tree: gameTree(["e4", "c5"]) } })
    ).not.toBe(base);
  });

  it("keeps the base key across a title or policy change, not a kind change", () => {
    const key = addInputBaseKey(input);
    expect(
      addInputBaseKey({ ...input, destination: { ...input.destination, title: "x" } as never })
    ).toBe(key);
    expect(
      addInputBaseKey({
        ...input,
        destination: { kind: "new-chapter", title: "Tal – Botvinnik", chapterKind: "opening" }
      })
    ).not.toBe(key);
    expect(
      addInputBaseKey({ ...input, destination: { kind: "existing-chapter", chapterId: "c" } })
    ).not.toBe(key);
  });
});

describe("preview text", () => {
  const tree = gameTree(["e4", "e5", "Nf3", "Nc6", "Bb5"]);
  const bb5 = nodeBySan(tree, "Bb5");
  const conflict = {
    positionKey: "k",
    fen: bb5.fenBefore,
    existingUcis: ["f1c4"],
    preferredUci: null,
    newUci: "f1b5",
    newSan: "Bb5",
    path: "1. e4 e5 2. Nf3 Nc6"
  };

  it("describes a conflict at the game's path", () => {
    expect(conflictText(conflict)).toBe(
      "At 1. e4 e5 2. Nf3 Nc6: you play Bc4 here; this adds Bb5 as an alternative"
    );
    expect(
      conflictText({ ...conflict, preferredUci: "f1c4", existingUcis: ["f1c4", "d2d4"] })
    ).toContain("you play Bc4 here");
    expect(
      conflictText({ ...conflict, preferredUci: null, existingUcis: ["d2d4", "f1c4"] })
    ).toContain("you play d4 here");
    // A stored preference that is no longer supported isn't named.
    expect(
      conflictText({ ...conflict, preferredUci: "f1b5", existingUcis: ["f1c4", "d2d4"] })
    ).toContain("you play Bc4 here");
  });

  it("falls back to the move number without a path", () => {
    expect(conflictText({ ...conflict, path: "" })).toBe(
      "At move 3: you play Bc4 here; this adds Bb5 as an alternative"
    );
  });
});

describe("stores", () => {
  it("opens and closes the add dialog and remembers the repertoire", () => {
    const store = useAddToRepertoireStore.getState();
    const source = sourceFromBoard({
      gameId: null,
      headers: {},
      rootFen: START_FEN,
      moveTree: gameTree(["e4"]),
      currentNodeId: "root"
    });
    store.open({ source, initialScope: { kind: "whole-game" }, entry: "board" });
    expect(useAddToRepertoireStore.getState().request?.entry).toBe("board");
    store.remember("r1");
    store.close();
    expect(useAddToRepertoireStore.getState()).toMatchObject({
      request: null,
      lastRepertoireId: "r1"
    });
  });

  it("shows a success notice with an action, and failures by default", () => {
    const onSelect = () => undefined;
    useAppNoticeStore
      .getState()
      .show("Added", { tone: "success", action: { label: "Open chapter", onSelect } });
    expect(useAppNoticeStore.getState()).toMatchObject({ message: "Added", tone: "success" });
    expect(useAppNoticeStore.getState().action?.label).toBe("Open chapter");
    useAppNoticeStore.getState().show("Failed");
    expect(useAppNoticeStore.getState()).toMatchObject({ tone: "danger", action: null });
    useAppNoticeStore.getState().dismiss();
  });
});
