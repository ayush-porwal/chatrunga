import { beforeEach, describe, expect, it } from "vitest";
import { fenAfterUci } from "@chaturanga/shared/chess/position";
import { exportRepertoirePgn } from "@chaturanga/shared/chess/repertoire-pgn";
import type { ChapterSaveResult } from "@chaturanga/shared/types/repertoire";
import {
  addLine,
  chapterOf,
  detailOf,
  rootNode
} from "../features/repertoire/__fixtures__/repertoire";
import { decisionDraftKey } from "../features/repertoire/repertoire-model";
import {
  promoteChild,
  promotionTarget,
  removeSubtree,
  reuseUnchangedTree,
  UNDO_LIMIT,
  useRepertoireWorkspaceStore
} from "./repertoire-workspace-store";

const store = () => useRepertoireWorkspaceStore.getState();

function sampleTree() {
  let tree = [rootNode()];
  ({ tree } = addLine(tree, "root", ["e2e4", "e7e5", "g1f3"], "w"));
  ({ tree } = addLine(tree, "w0", ["c7c5"], "s"));
  return tree;
}

function load(nodeId?: string) {
  store().loadChapter(detailOf(), chapterOf(sampleTree()), { nodeId });
}

function play(uci: string) {
  const fen = store().chapter!.tree.find((node) => node.id === store().selectedNodeId)!.fenAfter;
  return store().playMove(uci, uci, fenAfterUci(fen, uci)!);
}

describe("repertoire workspace store", () => {
  beforeEach(() => store().reset());

  it("loads a chapter at a known node, or the root", () => {
    load("w1");
    expect(store().selectedNodeId).toBe("w1");
    expect(store().baseRevision).toBe(4);
    expect(store().orientation).toBe("white");
    load("missing");
    expect(store().selectedNodeId).toBe("root");
    expect(store().dirty).toBe(false);
  });

  it("selects an existing child instead of adding a duplicate move", () => {
    load();
    const result = play("e2e4");
    expect(result).toEqual({ nodeId: "w0", created: false });
    expect(store().dirty).toBe(false);
    expect(store().chapter!.tree).toHaveLength(5);
  });

  it("adds new moves with the default edges and selects them", () => {
    load("w2");
    const reply = play("b8c6");
    expect(reply.created).toBe(true);
    expect(store().chapter!.nodeMeta[reply.nodeId]).toEqual({ edge: "covered" });
    const own = play("f1c4");
    expect(store().chapter!.nodeMeta[own.nodeId]).toEqual({ edge: "reference" });
    expect(store().selectedNodeId).toBe(own.nodeId);
    expect(store().dirty).toBe(true);
    expect(store().generation).toBe(2);
  });

  it("stores castling as the king's two-square move", () => {
    let tree = [rootNode()];
    ({ tree } = addLine(tree, "root", ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6"], "m"));
    store().loadChapter(detailOf(), chapterOf(tree), { nodeId: "m5" });
    const fen = store().chapter!.tree.find((node) => node.id === "m5")!.fenAfter;
    const fenAfter = fenAfterUci(fen, "e1h1")!;
    const result = store().playMove("e1h1", "O-O", fenAfter);
    expect(store().chapter!.tree.find((node) => node.id === result.nodeId)!.uci).toBe("e1g1");
  });

  it("flips node metadata and drops unset flags", () => {
    load();
    store().setNodeMeta("w0", { edge: "reference", disabled: true });
    expect(store().chapter!.nodeMeta.w0).toEqual({ edge: "reference", disabled: true });
    store().setNodeMeta("w0", { edge: "included", disabled: false });
    expect(store().chapter!.nodeMeta.w0).toEqual({ edge: "included" });
  });

  it("edits comments and shapes", () => {
    load();
    store().setComment("w0", "Main move");
    store().setShapes("w0", [{ orig: "e2", dest: "e4", color: "green" }], []);
    const node = store().chapter!.tree.find((item) => item.id === "w0")!;
    expect(node.comment).toBe("Main move");
    expect(node.arrows).toHaveLength(1);
    store().setComment("w0", "  ");
    expect(store().chapter!.tree.find((item) => item.id === "w0")!.comment).toBeNull();
  });

  it("deletes a line with its metadata and undoes it", () => {
    load("w2");
    store().setNodeMeta("w1", { edge: "covered" });
    expect(store().deleteLine("w1")).toBe(true);
    expect(store().chapter!.tree.map((node) => node.id)).toEqual(["root", "w0", "s0"]);
    expect(store().chapter!.nodeMeta.w1).toBeUndefined();
    expect(store().selectedNodeId).toBe("w0");
    expect(store().undo()).toBe(true);
    expect(store().chapter!.tree).toHaveLength(5);
    expect(store().chapter!.nodeMeta.w1).toEqual({ edge: "covered" });
    // The edge change before it is a step of its own.
    expect(store().undo()).toBe(true);
    expect(store().chapter!.nodeMeta.w1).toBeUndefined();
    expect(store().undo()).toBe(false);
    expect(store().deleteLine("root")).toBe(false);
  });

  it("keeps at most the undo limit", () => {
    load();
    for (let index = 0; index < UNDO_LIMIT + 5; index += 1) {
      store().promoteVariation(index % 2 ? "w1" : "s0");
    }
    expect(store().undoStack).toHaveLength(UNDO_LIMIT);
    while (store().undo());
    expect(store().redoStack).toHaveLength(UNDO_LIMIT);
  });

  it("promotes a variation to the main line", () => {
    load();
    expect(store().promoteVariation("s0")).toBe(true);
    expect(store().chapter!.tree.find((node) => node.id === "w0")!.children).toEqual(["s0", "w1"]);
    // On the main line already: nothing to promote, and nothing to undo.
    expect(store().promoteVariation("s0")).toBe(false);
    expect(store().undoStack).toHaveLength(1);
  });

  it("promotes the variation a deeper move belongs to", () => {
    load();
    expect(promotionTarget(store().chapter!.tree, "w2")).toBeNull();
    expect(promotionTarget(store().chapter!.tree, "root")).toBeNull();
    store().promoteVariation("s0");
    // 1... e5 2. Nf3 is now the side line: promoting from Nf3 moves 1... e5 back up.
    expect(promotionTarget(store().chapter!.tree, "w2")).toBe("w1");
    store().promoteVariation("w2");
    expect(store().chapter!.tree.find((node) => node.id === "w0")!.children).toEqual(["w1", "s0"]);
  });

  it("undoes and redoes structural edits, keeping comments typed since", () => {
    load("w2");
    const added = play("b8c6");
    store().setComment("w2", "Develops");
    store().setNodeMeta("w1", { trainingStart: true });
    store().promoteVariation("s0");
    expect(store().undoStack).toHaveLength(3);

    expect(store().undo()).toBe(true);
    expect(store().chapter!.tree.find((node) => node.id === "w0")!.children).toEqual(["w1", "s0"]);
    expect(store().undo()).toBe(true);
    expect(store().chapter!.nodeMeta.w1).toBeUndefined();
    expect(store().undo()).toBe(true);
    // The added move is gone and its parent selected; the comment typed after it stays.
    expect(store().chapter!.tree.some((node) => node.id === added.nodeId)).toBe(false);
    expect(store().selectedNodeId).toBe("w2");
    expect(store().chapter!.tree.find((node) => node.id === "w2")!.comment).toBe("Develops");
    expect(store().dirty).toBe(true);
    expect(store().undo()).toBe(false);

    expect(store().redo()).toBe(true);
    expect(store().chapter!.tree.some((node) => node.id === added.nodeId)).toBe(true);
    expect(store().redo()).toBe(true);
    expect(store().chapter!.nodeMeta.w1).toEqual({ edge: "included", trainingStart: true });
    // A new edit drops what is left to redo.
    store().setNodeMeta("w0", { disabled: true });
    expect(store().redoStack).toHaveLength(0);
    expect(store().redo()).toBe(false);
  });

  it("starts each chapter load with no undo or redo", () => {
    load();
    store().promoteVariation("s0");
    store().undo();
    expect(store().redoStack).toHaveLength(1);
    load();
    expect(store().undoStack).toHaveLength(0);
    expect(store().redoStack).toHaveLength(0);
  });

  it("exports the promoted variation as the PGN main line", () => {
    load();
    const pgn = () => exportRepertoirePgn([store().chapter!]);
    expect(pgn()).toContain("1. e4 e5 (1... c5) 2. Nf3 *");
    store().promoteVariation("s0");
    expect(pgn()).toContain("1. e4 c5 (1... e5 2. Nf3) *");
    store().undo();
    expect(pgn()).toContain("1. e4 e5 (1... c5) 2. Nf3 *");
    store().redo();
    expect(pgn()).toContain("1. e4 c5 (1... e5 2. Nf3) *");
  });

  it("adopts a save result unless the draft changed while it ran", () => {
    load();
    play("d2d4");
    const generation = store().generation;
    const saved = { ...store().chapter!, revision: 2 };
    const result: ChapterSaveResult = {
      repertoire: detailOf({ revision: 5 }),
      chapter: saved,
      decisionsChanged: 0
    };
    store().markSaving();
    store().saveSucceeded(result, generation);
    expect(store().dirty).toBe(false);
    expect(store().baseRevision).toBe(5);
    expect(store().saveState).toEqual({ status: "idle" });

    play("c2c4");
    const before = store().generation;
    store().setComment("root", "newer edit");
    store().saveSucceeded(
      { ...result, repertoire: detailOf({ revision: 6 }), chapter: { ...saved, revision: 3 } },
      before
    );
    expect(store().dirty).toBe(true);
    expect(store().baseRevision).toBe(6);
    expect(store().chapter!.tree.find((node) => node.id === "root")!.comment).toBe("newer edit");
    expect(store().chapter!.revision).toBe(3);
  });

  it("keeps the draft's tree identity when a save returns the same tree", () => {
    load();
    play("d2d4");
    const local = store().chapter!.tree;
    // A save result is a fresh copy from the main process (absent optional fields included).
    const copy = local.map((node) => ({ ...node, clockAfter: undefined }));
    const result: ChapterSaveResult = {
      repertoire: detailOf({ revision: 5 }),
      chapter: { ...store().chapter!, tree: copy, revision: 2 },
      decisionsChanged: 0
    };
    store().saveSucceeded(result, store().generation);
    expect(store().chapter!.tree).toBe(local);
    expect(store().chapter!.revision).toBe(2);

    const normalized = local.map((node) =>
      node.id === "root" ? { ...node, comment: "normalized" } : node
    );
    store().saveSucceeded(
      { ...result, chapter: { ...result.chapter, tree: normalized, revision: 3 } },
      store().generation
    );
    expect(store().chapter!.tree).toBe(normalized);
  });

  it("reuses a tree only when every node matches", () => {
    const tree = sampleTree();
    expect(reuseUnchangedTree(tree, tree.slice(0, -1))).not.toBe(tree);
    const moved = tree.map((node) =>
      node.id === "w0" ? { ...node, children: [...node.children].reverse() } : node
    );
    expect(reuseUnchangedTree(tree, moved)).toBe(moved);
    const arrows = tree.map((node) =>
      node.id === "w1"
        ? {
            ...node,
            arrows: [{ orig: "e2" as const, dest: "e4" as const, color: "green" as const }]
          }
        : node
    );
    expect(reuseUnchangedTree(tree, arrows)).toBe(arrows);
    expect(reuseUnchangedTree(tree, structuredClone(tree))).toBe(tree);
  });

  it("ignores a save result for another chapter except its revision", () => {
    load();
    store().saveSucceeded(
      {
        repertoire: detailOf({ revision: 9 }),
        chapter: chapterOf(sampleTree(), {}, { id: "other" }),
        decisionsChanged: 0
      },
      0
    );
    expect(store().chapterId).toBe("c1");
    expect(store().baseRevision).toBe(9);
  });

  it("records save errors and adopts newer revisions only", () => {
    load();
    store().saveFailed("stale", true);
    expect(store().saveState).toEqual({ status: "error", message: "stale", stale: true });
    store().clearSaveError();
    store().adoptRevision(2);
    expect(store().baseRevision).toBe(4);
    store().adoptRevision(7);
    expect(store().baseRevision).toBe(7);
  });

  it("flips the board and remembers decisions per repertoire", () => {
    load();
    store().flip();
    expect(store().orientation).toBe("black");
    store().rememberDecision({
      repertoireId: "r1",
      positionKey: "k",
      acceptedUcis: ["e2e4"],
      preferredUci: "e2e4",
      prompt: null,
      hint: null,
      wrongMoveFeedback: {},
      paused: false
    });
    load();
    expect(store().decisions.k?.preferredUci).toBe("e2e4");
    store().loadChapter(detailOf({ id: "r2" }), chapterOf(sampleTree()));
    expect(store().decisions).toEqual({});
  });
});

describe("tree edits", () => {
  it("removes a subtree and unlinks it from its parent", () => {
    const { tree, removed, parentId } = removeSubtree(sampleTree(), "w0");
    expect(tree.map((node) => node.id)).toEqual(["root"]);
    expect(tree[0].children).toEqual([]);
    expect([...removed].sort()).toEqual(["s0", "w0", "w1", "w2"]);
    expect(parentId).toBe("root");
    expect(removeSubtree(sampleTree(), "root").removed.size).toBe(0);
  });

  it("leaves the tree alone when promoting the root or a main-line move", () => {
    const tree = sampleTree();
    expect(promoteChild(tree, "root")).toEqual(tree);
    expect(promoteChild(tree, "w1")).toEqual(tree);
  });
});

describe("staging a move from a game comparison", () => {
  beforeEach(() => store().reset());

  it("adds a new reply under the node with the asked edge, selected and unsaved", () => {
    load();
    // After 1.e4 e5 2.Nf3 (w2), Black's 2…Nc6 is new: a covered reply.
    const result = store().stageMove("w2", "b8c6", "covered");
    expect(result).toMatchObject({ created: true });
    const node = store().chapter!.tree.find((item) => item.id === result!.nodeId)!;
    expect(node).toMatchObject({ parentId: "w2", uci: "b8c6", san: "Nc6" });
    expect(store().selectedNodeId).toBe(node.id);
    expect(store().chapter!.nodeMeta[node.id]).toEqual({ edge: "covered" });
    expect(store().dirty).toBe(true);
  });

  it("adds the player's played alternative as a reference move (never accepted)", () => {
    load();
    // After 1.e4 e5 (w1), White's 2.Bc4 instead of 2.Nf3.
    const result = store().stageMove("w1", "f1c4", "reference");
    expect(store().chapter!.nodeMeta[result!.nodeId]).toEqual({ edge: "reference" });
    // The decision stays selected, so Choices shows the new move with Accept.
    expect(store().selectedNodeId).toBe("w1");
    // Adding it and setting its edge are one undo step.
    expect(store().undoStack).toHaveLength(1);
    store().undo();
    expect(store().chapter!.tree.some((node) => node.id === result!.nodeId)).toBe(false);
  });

  it("only selects a move the chapter already has with that edge", () => {
    store().loadChapter(detailOf(), chapterOf(sampleTree(), { w1: { edge: "covered" } }));
    const generation = store().generation;
    expect(store().stageMove("w0", "e7e5", "covered")).toEqual({ nodeId: "w1", created: false });
    expect(store().selectedNodeId).toBe("w1");
    expect(store().generation).toBe(generation);
    expect(store().dirty).toBe(false);
  });

  it("marks an existing reference or disabled reply as covered (enabled)", () => {
    store().loadChapter(
      detailOf(),
      chapterOf(sampleTree(), {
        w1: { edge: "reference" },
        s0: { edge: "covered", disabled: true }
      })
    );
    expect(store().stageMove("w0", "e7e5", "covered")).toEqual({ nodeId: "w1", created: false });
    expect(store().chapter!.nodeMeta.w1).toEqual({ edge: "covered" });
    expect(store().dirty).toBe(true);
    store().stageMove("w0", "c7c5", "covered");
    expect(store().chapter!.nodeMeta.s0).toEqual({ edge: "covered" });
    expect(store().selectedNodeId).toBe("s0");
  });

  it("never demotes an existing move when staging it as reference", () => {
    load();
    expect(store().stageMove("w1", "g1f3", "reference")).toEqual({ nodeId: "w2", created: false });
    expect(store().chapter!.nodeMeta.w2).toBeUndefined();
    expect(store().selectedNodeId).toBe("w1");
    expect(store().dirty).toBe(false);
  });

  it("adopts the open chapter's stored revision with the repertoire's", () => {
    load();
    store().adoptRevision(9, 4);
    expect(store().baseRevision).toBe(9);
    expect(store().chapter!.revision).toBe(4);
    store().adoptRevision(10);
    expect(store().chapter!.revision).toBe(4);
  });

  it("changes nothing for an unknown node or an illegal move", () => {
    load();
    expect(store().stageMove("missing", "e2e4", "covered")).toBeNull();
    expect(store().stageMove("w0", "e2e4", "covered")).toBeNull();
    expect(store().dirty).toBe(false);
  });

  it("stages standard-UCI castling", () => {
    let tree = [rootNode()];
    ({ tree } = addLine(tree, "root", ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6"], "w"));
    store().loadChapter(detailOf(), chapterOf(tree));
    const result = store().stageMove("w5", "e1g1", "reference");
    const node = store().chapter!.tree.find((item) => item.id === result!.nodeId)!;
    expect(node.san).toBe("O-O");
  });
});

describe("repertoire workspace decision drafts", () => {
  const key = decisionDraftKey("r1", "k1", "prompt");
  const draft = () => store().decisionDrafts[key];

  beforeEach(() => {
    store().reset();
    useRepertoireWorkspaceStore.setState({ decisionDrafts: {} });
  });

  it("keeps typed text across chapters, repertoires and resets", () => {
    store().setDecisionText("r1", "k1", "prompt", "Develop");
    load();
    store().loadChapter(detailOf({ id: "r2" }), chapterOf(sampleTree()));
    store().reset();
    expect(draft()).toMatchObject({ text: "Develop", status: "pending", generation: 1 });
  });

  it("is cleared only by a confirmed save of the text it sent", () => {
    store().setDecisionText("r1", "k1", "prompt", "Develop");
    const sent = store().markDecisionTextSaving(key)!;
    expect(draft().status).toBe("saving");
    store().setDecisionText("r1", "k1", "prompt", "Develop with tempo");
    store().decisionTextSaved(key, sent);
    // Typed while it saved: the newer text waits for its own write.
    expect(draft()).toMatchObject({ text: "Develop with tempo", status: "pending" });
    store().decisionTextSaved(key, store().markDecisionTextSaving(key)!);
    expect(draft()).toBeUndefined();
    expect(store().markDecisionTextSaving(key)).toBeNull();
  });

  it("keeps feedback per wrong move and a pause as drafts of their own", () => {
    store().setWrongMoveFeedback("r1", "k1", "d2d4", "We play 1.e4");
    store().setWrongMoveFeedback("r1", "k1", "c2c4", "Not the English");
    store().setDecisionPaused("r1", "k1", true);
    const d4 = decisionDraftKey("r1", "k1", "feedback", "d2d4");
    const paused = decisionDraftKey("r1", "k1", "paused");
    expect(store().decisionDrafts[d4]).toEqual({
      repertoireId: "r1",
      positionKey: "k1",
      field: "feedback",
      uci: "d2d4",
      text: "We play 1.e4",
      generation: 1,
      status: "pending"
    });
    expect(Object.keys(store().decisionDrafts)).toHaveLength(3);
    // Toggling back while a pause saves is a newer edit, written after it.
    const sent = store().markDecisionTextSaving(paused)!;
    store().setDecisionPaused("r1", "k1", false);
    store().decisionTextSaved(paused, sent);
    expect(store().decisionDrafts[paused]).toMatchObject({
      paused: false,
      status: "pending",
      generation: 2
    });
  });

  it("keeps a failed write's text; Retry (clearSaveError) leaves a stale one alone", () => {
    const hint = decisionDraftKey("r1", "k1", "hint");
    store().setDecisionText("r1", "k1", "prompt", "Develop");
    store().setDecisionText("r1", "k1", "hint", "Knight to f3");
    store().decisionTextFailed(key, "disk full", false);
    store().decisionTextFailed(hint, "repertoire changed", true);
    expect(draft()).toMatchObject({
      text: "Develop",
      status: "error",
      error: { message: "disk full", stale: false }
    });
    store().clearSaveError();
    expect(draft()).toMatchObject({ status: "pending", error: undefined });
    expect(store().decisionDrafts[hint].status).toBe("error");
    store().clearDecisionTextError(hint);
    expect(store().decisionDrafts[hint].status).toBe("pending");
    store().discardDecisionText(hint);
    expect(store().decisionDrafts[hint]).toBeUndefined();
    // Nothing to fail or clear once it's gone.
    store().decisionTextFailed(hint, "late", false);
    store().clearDecisionTextError(hint);
    expect(store().decisionDrafts[hint]).toBeUndefined();
  });
});
