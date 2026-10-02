import { describe, expect, it } from "vitest";
import type { MoveNode } from "../types/chess";
import type { RepertoireDecision, RepertoireNodeMeta } from "../types/repertoire";
import { applySan, START_FEN } from "./position";
import { rootPly } from "./pgn";
import {
  acceptanceFingerprint,
  buildChapterLookup,
  collectDecisions,
  computeScopeStates,
  defaultImportNodeMeta,
  effectiveAcceptedUcis,
  effectivePreferredUci,
  reconcileDecisions,
  type RepertoireChapterContent
} from "./repertoire-index";
import { positionKey } from "./repertoire-position";

/** Builds a tree from SAN lines; shared prefixes share nodes. Ids are the SAN path (`e4/e5`). */
function treeFromLines(lines: string[][], rootFen = START_FEN): MoveNode[] {
  const root: MoveNode = {
    id: "root",
    parentId: null,
    san: null,
    uci: null,
    fenBefore: rootFen,
    fenAfter: rootFen,
    ply: rootPly(rootFen),
    nags: [],
    comment: null,
    arrows: [],
    highlights: [],
    children: []
  };
  const byId = new Map([[root.id, root]]);
  for (const line of lines) {
    let parent = root;
    const path: string[] = [];
    for (const san of line) {
      path.push(san);
      const id = path.join("/");
      let node = byId.get(id);
      if (!node) {
        const applied = applySan(parent.fenAfter, san);
        if (!applied) throw new Error(`illegal ${san} after ${path.join(" ")}`);
        node = {
          id,
          parentId: parent.id,
          san: applied.san,
          uci: applied.uci,
          fenBefore: parent.fenAfter,
          fenAfter: applied.fen,
          ply: parent.ply + 1,
          nags: [],
          comment: null,
          arrows: [],
          highlights: [],
          children: []
        };
        parent.children.push(id);
        byId.set(id, node);
      }
      parent = node;
    }
  }
  return [...byId.values()];
}

function chapter(
  id: string,
  lines: string[][],
  nodeMeta: Record<string, RepertoireNodeMeta> = {},
  extra: Partial<RepertoireChapterContent> = {}
): RepertoireChapterContent {
  return {
    id,
    kind: "opening",
    enabled: true,
    sortOrder: 0,
    tree: treeFromLines(lines),
    nodeMeta,
    ...extra
  };
}

describe("buildChapterLookup", () => {
  it("indexes nodes, children, paths and position keys", () => {
    const lookup = buildChapterLookup(
      chapter("c", [
        ["e4", "e5", "Nf3"],
        ["e4", "c5"]
      ])
    );
    expect(lookup.order).toEqual(["root", "e4", "e4/e5", "e4/e5/Nf3", "e4/c5"]);
    expect(lookup.childrenById.get("e4")).toEqual(["e4/e5", "e4/c5"]);
    expect(lookup.parentPath.get("e4/e5/Nf3")).toEqual(["root", "e4", "e4/e5", "e4/e5/Nf3"]);
    expect(lookup.positionKeys.get("root")).toBe(positionKey(START_FEN));
  });

  it("stays finite on a malformed tree with a cycle", () => {
    const tree = treeFromLines([["e4", "e5"]]);
    tree.find((node) => node.id === "e4/e5")!.children.push("e4", "missing");
    const lookup = buildChapterLookup({ tree });
    expect(lookup.order).toEqual(["root", "e4", "e4/e5"]);
  });

  it("requires a root", () => {
    expect(() => buildChapterLookup({ tree: [] })).toThrow(/root/);
  });
});

describe("computeScopeStates", () => {
  const lines = [
    ["e4", "e5", "Nf3", "Nc6", "Bb5"],
    ["e4", "c5", "Nf3"]
  ];

  it("is active everywhere without markers", () => {
    const states = computeScopeStates(chapter("c", lines));
    expect([...states.values()].every((state) => state === "active")).toBe(true);
  });

  it("starts training at a marked node and stops after a stop marker", () => {
    const states = computeScopeStates(
      chapter("c", lines, {
        "e4/e5": { edge: "covered", trainingStart: true },
        "e4/e5/Nf3/Nc6": { edge: "covered", trainingStop: true }
      })
    );
    expect(states.get("root")).toBe("before-start");
    expect(states.get("e4")).toBe("before-start");
    expect(states.get("e4/c5")).toBe("before-start");
    expect(states.get("e4/e5")).toBe("active");
    expect(states.get("e4/e5/Nf3/Nc6")).toBe("active");
    expect(states.get("e4/e5/Nf3/Nc6/Bb5")).toBe("after-stop");
  });

  it("disables descendants and turns reference edges into reference subtrees", () => {
    const states = computeScopeStates(
      chapter("c", lines, {
        "e4/e5": { edge: "covered", disabled: true },
        "e4/c5": { edge: "reference" }
      })
    );
    expect(states.get("e4/e5/Nf3/Nc6/Bb5")).toBe("disabled");
    expect(states.get("e4/c5")).toBe("reference");
    expect(states.get("e4/c5/Nf3")).toBe("reference");
    expect(states.get("e4")).toBe("active");
  });

  it("marks whole reference or disabled chapters", () => {
    const reference = computeScopeStates(chapter("c", lines, {}, { kind: "reference" }));
    expect(new Set(reference.values())).toEqual(new Set(["reference"]));
    const disabled = computeScopeStates(chapter("c", lines, {}, { enabled: false }));
    expect(new Set(disabled.values())).toEqual(new Set(["disabled"]));
  });
});

describe("collectDecisions", () => {
  it("collects own-side decisions with accepted moves in authored order", () => {
    const decisions = collectDecisions("white", [
      chapter("c", [["e4", "e5", "Nf3"], ["e4", "c5", "Nf3"], ["d4"]])
    ]);
    const start = decisions.get(positionKey(START_FEN))!;
    expect([...start.acceptedUcis]).toEqual(["e2e4", "d2d4"]);
    expect(decisions.size).toBe(3); // start, after 1.e4 e5, after 1.e4 c5
  });

  it("only keys positions of the repertoire's color", () => {
    const decisions = collectDecisions("black", [chapter("c", [["e4", "e5", "Nf3", "Nc6"]])]);
    expect([...decisions.values()].map((d) => [...d.acceptedUcis])).toEqual([["e7e5"], ["b8c6"]]);
  });

  it("counts a transposed position once across chapters, with every occurrence", () => {
    const decisions = collectDecisions("black", [
      chapter("a", [["d4", "d5", "Nf3", "Nf6"]], {}, { sortOrder: 0 }),
      chapter("b", [["Nf3", "d5", "d4", "Nf6", "c4"]], {}, { sortOrder: 1 })
    ]);
    const key = positionKey(treeFromLines([["d4", "d5", "Nf3"]]).at(-1)!.fenAfter);
    const shared = decisions.get(key)!;
    expect(shared.occurrences.map((o) => [o.chapterId, o.chapterOrder])).toEqual([
      ["a", 0],
      ["b", 1]
    ]);
    expect([...shared.acceptedUcis]).toEqual(["g8f6"]);
    // after 1.d4 · after 1.Nf3 · the transposed position
    expect(decisions.size).toBe(3);
  });

  it("keeps repeated positions as finite occurrences", () => {
    const shuffle = ["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8"];
    const decisions = collectDecisions("white", [chapter("c", [shuffle])]);
    const start = decisions.get(positionKey(START_FEN))!;
    expect(start.occurrences.map((o) => o.nodeId)).toEqual(["root", "Nf3/Nf6/Ng1/Ng8"]);
    expect(decisions.size).toBe(2);
  });

  it("never trains reference chapters, reference edges or disabled chapters", () => {
    const lines = [["e4", "e5", "Nf3"]];
    expect(collectDecisions("white", [chapter("r", lines, {}, { kind: "reference" })]).size).toBe(
      0
    );
    expect(collectDecisions("white", [chapter("d", lines, {}, { enabled: false })]).size).toBe(0);
    const viaReference = collectDecisions("white", [
      chapter("c", [["e4", "e5", "Nf3"], ["d4"]], { e4: { edge: "reference" } })
    ]);
    expect([...viaReference.values()].map((d) => [...d.acceptedUcis])).toEqual([["d2d4"]]);
  });

  it("respects start/stop boundaries", () => {
    const lines = [["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4"]];
    const decisions = collectDecisions("white", [
      chapter("c", lines, {
        "e4/e5": { edge: "covered", trainingStart: true },
        "e4/e5/Nf3/Nc6/Bb5/a6": { edge: "covered", trainingStop: true }
      })
    ]);
    // 1.e4 is before the start; 3.Bb5 is trained; 4.Ba4 is after the stop.
    expect([...decisions.values()].map((d) => [...d.acceptedUcis])).toEqual([["g1f3"], ["f1b5"]]);
  });
});

describe("decision helpers", () => {
  const decision: RepertoireDecision = {
    repertoireId: "r",
    positionKey: "k",
    acceptedUcis: ["e2e4", "d2d4", "c2c4"],
    preferredUci: "d2d4",
    prompt: null,
    hint: null,
    wrongMoveFeedback: {},
    paused: false
  };

  it("intersects stored choices with supported ones", () => {
    expect(effectiveAcceptedUcis(decision, new Set(["c2c4", "e2e4", "g1f3"]))).toEqual([
      "e2e4",
      "c2c4"
    ]);
  });

  it("falls back to the first supported choice when the preference is inactive", () => {
    expect(effectivePreferredUci(decision, new Set(["d2d4", "e2e4"]))).toBe("d2d4");
    expect(effectivePreferredUci(decision, new Set(["c2c4", "e2e4"]))).toBe("e2e4");
    expect(effectivePreferredUci(decision, new Set())).toBeNull();
  });

  it("fingerprints order-independently", () => {
    expect(acceptanceFingerprint(["e2e4", "d2d4", "e2e4"])).toBe("d2d4,e2e4");
    expect(acceptanceFingerprint(["d2d4", "e2e4"])).toBe(acceptanceFingerprint(["e2e4", "d2d4"]));
  });

  it("reconciles new, grown, unchanged and unsupported decisions", () => {
    const collected = collectDecisions("white", [chapter("c", [["e4", "e5", "Nf3"], ["d4"]])]);
    const startKey = positionKey(START_FEN);
    const afterE5 = [...collected.keys()].find((key) => key !== startKey)!;
    const existing: RepertoireDecision[] = [
      { ...decision, positionKey: startKey, acceptedUcis: ["c2c4", "e2e4"], preferredUci: "c2c4" },
      { ...decision, positionKey: "gone", acceptedUcis: ["a2a3"], preferredUci: "a2a3" }
    ];
    const { upserts, suspendedKeys } = reconcileDecisions(existing, collected, {
      repertoireId: "r"
    });
    expect(suspendedKeys).toEqual(["gone"]);
    const start = upserts.find((d) => d.positionKey === startKey)!;
    expect(start.acceptedUcis).toEqual(["c2c4", "e2e4", "d2d4"]);
    expect(start.preferredUci).toBe("c2c4"); // inactive preference is kept
    const fresh = upserts.find((d) => d.positionKey === afterE5)!;
    expect(fresh).toMatchObject({
      repertoireId: "r",
      acceptedUcis: ["g1f3"],
      preferredUci: "g1f3"
    });

    // Re-running with the result stored changes nothing.
    const again = reconcileDecisions(upserts, collected, { repertoireId: "r" });
    expect(again).toEqual({ upserts: [], suspendedKeys: [] });
  });

  it("fills in a missing preference", () => {
    const collected = collectDecisions("white", [chapter("c", [["e4"]])]);
    const key = positionKey(START_FEN);
    const { upserts } = reconcileDecisions(
      [{ ...decision, positionKey: key, acceptedUcis: ["e2e4"], preferredUci: null }],
      collected,
      { repertoireId: "r" }
    );
    expect(upserts).toEqual([expect.objectContaining({ preferredUci: "e2e4" })]);
  });
});

describe("defaultImportNodeMeta", () => {
  it("includes the first own move, references own alternatives and covers opponent moves", () => {
    const tree = treeFromLines([["e4", "e5", "Nf3"], ["e4", "e5", "Bc4"], ["e4", "c5"], ["d4"]]);
    const meta = defaultImportNodeMeta("white", tree);
    expect(meta).toEqual({
      e4: { edge: "included" },
      d4: { edge: "reference" },
      "e4/e5": { edge: "covered" },
      "e4/c5": { edge: "covered" },
      "e4/e5/Nf3": { edge: "included" },
      "e4/e5/Bc4": { edge: "reference" }
    });
    const decisions = collectDecisions("white", [
      { id: "c", kind: "opening", enabled: true, sortOrder: 0, tree, nodeMeta: meta }
    ]);
    expect([...decisions.values()].map((d) => [...d.acceptedUcis])).toEqual([["e2e4"], ["g1f3"]]);
  });
});
