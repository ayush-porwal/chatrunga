import { describe, expect, it } from "vitest";
import { importPgnText } from "@chaturanga/shared/chess/pgn";
import { applySan } from "@chaturanga/shared/chess/position";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type { AnalysisLine, MoveReview } from "@chaturanga/shared/types/engine";
import {
  resolveCommentaryMoves,
  reviewAnchorFor,
  tokenizeCommentary,
  type CommentaryMoveContext,
  type CommentaryMoveToken
} from "./commentary-moves";

// Blackburne Shilling trap; the commented move is 4.Nxe5 (ply 7).
const PGN = "1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3# 0-1";

function line(multipv: number, pv: string[]): AnalysisLine {
  const score = { type: "cp" as const, value: 0 };
  return { multipv, depth: 18, score, scoreWhite: score, pv };
}

function mainlineNodes(tree: MoveNode[]): MoveNode[] {
  const byId = new Map(tree.map((node) => [node.id, node]));
  const nodes: MoveNode[] = [];
  for (
    let cursor = byId.get(byId.get("root")?.children[0] ?? "");
    cursor;
    cursor = byId.get(cursor.children[0] ?? "")
  )
    nodes.push(cursor);
  return nodes;
}

function setup(overrides: Partial<MoveReview> = {}) {
  const tree = importPgnText(PGN).game.moveTree;
  const nodes = mainlineNodes(tree);
  const moves: MoveReview[] = nodes.map((node) => ({
    nodeId: node.id,
    ply: node.ply,
    san: node.san ?? "",
    playedMove: node.uci ?? "",
    fenBefore: node.fenBefore,
    fenAfter: node.fenAfter,
    evalBefore: { type: "cp", value: 0 },
    evalAfter: { type: "cp", value: 0 },
    evalLoss: 0,
    classification: "best",
    bestMove: node.uci,
    bestLine: node.uci ? [node.uci] : [],
    topLines: [],
    motifs: []
  }));
  const index = 6;
  const base = moves[index];
  if (!base) throw new Error("missing ply 7");
  const move: MoveReview = {
    ...base,
    classification: "blunder",
    bestMove: "f3d4",
    bestLine: ["f3d4", "e5d4", "e1g1"],
    topLines: [line(1, ["f3d4", "e5d4", "e1g1"]), line(2, ["c2c3", "d4f3", "d1f3"])],
    replyLines: [line(1, ["d8e7", "e5f7", "e7e4"])],
    ...overrides
  };
  moves[index] = move;
  const ctx: CommentaryMoveContext = { move, moves, moveTree: tree };
  return { tree, nodes, moves, move, ctx };
}

function resolveProse(prose: string, ctx: CommentaryMoveContext) {
  const segments = tokenizeCommentary(prose);
  const tokens = segments.filter(
    (segment): segment is CommentaryMoveToken => segment.kind === "move"
  );
  const resolved = resolveCommentaryMoves(segments, ctx);
  return tokens.map((token) => ({ text: token.text, target: resolved.get(token.index) ?? null }));
}

function fenAfter(startFen: string, sans: string[]): string {
  let fen = startFen;
  for (const san of sans) {
    const applied = applySan(fen, san);
    if (!applied) throw new Error(`illegal ${san}`);
    fen = applied.fen;
  }
  return fen;
}

describe("tokenizeCommentary", () => {
  it("splits SAN tokens with move numbers, castling, promotions and check/mate suffixes", () => {
    const segments = tokenizeCommentary(
      "After 4. Nxe5 Qg5, 14...Nf6 and 6… Bc5 follow O-O-O, e8=Q+ and Bxf7#."
    );
    const moves = segments.filter(
      (segment): segment is CommentaryMoveToken => segment.kind === "move"
    );
    expect(moves.map((token) => [token.text, token.san, token.plyHint])).toEqual([
      ["4. Nxe5", "Nxe5", 7],
      ["Qg5", "Qg5", null],
      ["14...Nf6", "Nf6", 28],
      ["6… Bc5", "Bc5", 12],
      ["O-O-O", "O-O-O", null],
      ["e8=Q+", "e8=Q+", null],
      ["Bxf7#", "Bxf7#", null]
    ]);
    expect(segments.map((segment) => segment.text).join("")).toBe(
      "After 4. Nxe5 Qg5, 14...Nf6 and 6… Bc5 follow O-O-O, e8=Q+ and Bxf7#."
    );
  });

  it("does not match inside words or bare squares used as squares", () => {
    const moves = tokenizeCommentary(
      "The knight on d5 eyes the e4 pawn; abc4 and Qa1s stay text, but c3 is a move."
    )
      .filter((segment) => segment.kind === "move")
      .map((segment) => segment.text);
    expect(moves).toEqual(["c3"]);
  });
});

describe("resolveCommentaryMoves", () => {
  it("resolves the played move to its own node through the main line", () => {
    const { ctx, nodes } = setup();
    const [played] = resolveProse("Nxe5 grabs a pawn.", ctx);
    expect(played?.target?.kind).toBe("played");
    expect(played?.target?.startNodeId).toBe("root");
    expect(played?.target?.moves).toHaveLength(7);
    expect(played?.target?.fenAfter).toBe(nodes[6]?.fenAfter);
  });

  it("keeps a consecutive best-line run together from the move's parent", () => {
    const { ctx, move, nodes } = setup();
    const result = resolveProse("The engine preferred Nxd4 exd4 O-O instead.", ctx);
    expect(result.map((item) => item.target?.kind)).toEqual(["best", "best", "best"]);
    for (const item of result) expect(item.target?.startNodeId).toBe(nodes[5]?.id);
    expect(result[2]?.target?.moves).toEqual(["Nxd4", "exd4", "O-O"]);
    expect(result[2]?.target?.fenAfter).toBe(fenAfter(move.fenBefore, ["Nxd4", "exd4", "O-O"]));
  });

  it("resolves history nearest to the commented move and the actual reply", () => {
    const { ctx } = setup();
    const [nc6, qg5] = resolveProse("Earlier Nc6 developed; after it Qg5 hit two pieces.", ctx);
    expect(nc6?.target).toMatchObject({ kind: "history", startNodeId: "root" });
    expect(nc6?.target?.moves).toHaveLength(4);
    expect(qg5?.target?.kind).toBe("history");
    expect(qg5?.target?.moves).toHaveLength(8);
  });

  it("resolves the stored reply line from the move's own node", () => {
    const { ctx, move } = setup();
    const result = resolveProse("It allowed Qe7 Nxf7 Qxe4+ with a winning attack.", ctx);
    expect(result.map((item) => item.target?.kind)).toEqual(["reply", "reply", "reply"]);
    expect(result[2]?.target?.startNodeId).toBe(move.nodeId);
    expect(result[2]?.target?.moves).toEqual(["Qe7", "Nxf7", "Qxe4+"]);
  });

  it("falls back to the next ply's best line when replyLines are missing", () => {
    const { ctx, moves, move } = setup({ replyLines: undefined });
    const next = moves[7];
    if (!next) throw new Error("missing ply 8");
    moves[7] = { ...next, bestLine: ["d8e7", "e5f7"] };
    const [qe7] = resolveProse("It allowed Qe7.", { ...ctx, moves });
    expect(qe7?.target).toMatchObject({ kind: "reply", startNodeId: move.nodeId, moves: ["Qe7"] });
  });

  it("resolves alternatives", () => {
    const { ctx } = setup();
    const [c3] = resolveProse("The engine also liked c3.", ctx);
    expect(c3?.target).toMatchObject({ kind: "alternative", moves: ["c3"] });
  });

  it("uses move-number prefixes to pick the right occurrence", () => {
    const { ctx } = setup();
    const [plain, numbered] = resolveProse("Nf3 early, and 7...Nf3# at the end.", ctx);
    expect(plain?.target?.moves).toHaveLength(3);
    expect(numbered?.target?.kind).toBe("game");
    expect(numbered?.target?.moves).toHaveLength(14);
  });

  it("accepts over-disambiguated SAN and leaves unknown or illegal moves as text", () => {
    const { ctx } = setup();
    const [nfxe5, qh5, bxf7] = resolveProse(
      "Nfxe5 was played; Qh5 never happened and Bb5 was impossible.",
      ctx
    );
    expect(nfxe5?.target?.kind).toBe("played");
    expect(qh5?.target).toBeNull();
    expect(bxf7?.target).toBeNull();
  });

  it("resolves a single token without run context", () => {
    const { ctx } = setup();
    const token: CommentaryMoveToken = {
      kind: "move",
      text: "O-O",
      san: "O-O",
      plyHint: null,
      index: 0
    };
    expect(resolveCommentaryMoves([token], ctx).get(0)).toMatchObject({
      kind: "best",
      moves: ["Nxd4", "exd4", "O-O"]
    });
  });
});

describe("reviewAnchorFor", () => {
  it("anchors variations to the nearest reviewed ancestor", () => {
    const { tree, moves, nodes } = setup();
    const reviews = new Map(moves.map((move) => [move.nodeId, move]));
    const variation: MoveNode = {
      ...(nodes[6] as MoveNode),
      id: "var1",
      parentId: nodes[5]?.id ?? null,
      children: []
    };
    const withVariation = tree
      .map((node) =>
        node.id === nodes[5]?.id ? { ...node, children: [...node.children, "var1"] } : node
      )
      .concat(variation);
    expect(reviewAnchorFor(withVariation, "var1", reviews)).toMatchObject({
      move: { ply: 6 },
      variation: true
    });
    expect(reviewAnchorFor(withVariation, nodes[6]?.id ?? "", reviews)).toMatchObject({
      move: { ply: 7 },
      variation: false
    });
    expect(reviewAnchorFor(withVariation, nodes[6]?.id ?? "", new Map())).toBeNull();
    expect(reviewAnchorFor(withVariation, "root", reviews)).toBeNull();
  });

  it("keeps the move a link was clicked from as the anchor for lines from its parent", () => {
    const { tree, moves, nodes } = setup();
    const reviews = new Map(moves.map((move) => [move.nodeId, move]));
    const played = nodes[6] as MoveNode;
    // A best-line variation replacing ply 7: it hangs off ply 6's node.
    const sibling: MoveNode = {
      ...played,
      id: "alt1",
      parentId: nodes[5]?.id ?? null,
      children: []
    };
    const withVariation = tree
      .map((node) =>
        node.id === nodes[5]?.id ? { ...node, children: [...node.children, "alt1"] } : node
      )
      .concat(sibling);
    expect(reviewAnchorFor(withVariation, "alt1", reviews, played.id)).toMatchObject({
      move: { ply: 7 },
      variation: true
    });
    // An unrelated preference (a later move) does not apply.
    expect(reviewAnchorFor(withVariation, "alt1", reviews, nodes[10]?.id ?? null)).toMatchObject({
      move: { ply: 6 },
      variation: true
    });
  });
});
