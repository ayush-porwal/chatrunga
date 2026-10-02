import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { importPgnText } from "@chaturanga/shared/chess/pgn";

const userData = mkdtempSync(join(tmpdir(), "chaturanga-repo-test-"));
vi.mock("electron", () => ({ app: { getPath: () => userData } }));

const { closeDb, getDb } = await import("./index");
const { gameRepository } = await import("./repositories");

const PGN = `[Event "Rapid"]
[White "Carlsen"]
[Black "Nepo"]
[WhiteElo "2830"]
[TimeControl "600+5"]
[ECO "C65"]
[Termination "Normal"]
[Result "1-0"]

1. e4 e5 2. Nf3 1-0`;

function saveImported() {
  const { game } = importPgnText(PGN);
  return gameRepository.save({ ...game, headers: game.headers });
}

describe("gameRepository (SQLite)", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM games");
  });

  afterAll(() => {
    closeDb();
    rmSync(userData, { recursive: true, force: true });
  });

  it("keeps every header through save and get", () => {
    const saved = saveImported();
    expect(gameRepository.get(saved.id)?.headers).toMatchObject({
      white: "Carlsen",
      whiteElo: "2830",
      timeControl: "600+5",
      eco: "C65",
      termination: "Normal",
      result: "1-0"
    });
  });

  it("stores the id the renderer chose for a new game", () => {
    const { game } = importPgnText(PGN);
    const saved = gameRepository.save({ ...game, id: "chosen-id" });
    expect(saved.id).toBe("chosen-id");
    expect(gameRepository.list().map((item) => item.id)).toEqual(["chosen-id"]);
  });

  it("rebuilds a damaged move tree from the stored PGN", () => {
    const saved = saveImported();
    getDb().prepare("UPDATE games SET move_tree_json = ? WHERE id = ?").run("{not json", saved.id);
    const reopened = gameRepository.get(saved.id);
    expect(reopened?.moveTree.filter((node) => node.san).map((node) => node.san)).toEqual(["e4", "e5", "Nf3"]);
  });

  it("moves a saved review onto the rebuilt tree, or drops one that doesn't fit", () => {
    const saved = saveImported();
    const mainline = saved.moveTree.filter((node) => node.san);
    const review = {
      engineId: "sf",
      depth: null,
      moveTimeMs: 100,
      createdAt: 1,
      summary: {},
      moves: mainline.map((node, index) => ({ nodeId: node.id, ply: index + 1, san: node.san, fenAfter: node.fenAfter }))
    };
    getDb()
      .prepare("UPDATE games SET move_tree_json = ?, review_json = ? WHERE id = ?")
      .run("{not json", JSON.stringify(review), saved.id);
    const reopened = gameRepository.get(saved.id)!;
    const rebuiltIds = new Set(reopened.moveTree.map((node) => node.id));
    expect(reopened.review?.moves.map((move) => move.san)).toEqual(["e4", "e5", "Nf3"]);
    expect(reopened.review?.moves.every((move) => rebuiltIds.has(move.nodeId))).toBe(true);

    // A damaged move entry drops the review; the game still opens.
    const damaged = { ...review, moves: [null, ...review.moves] };
    getDb().prepare("UPDATE games SET review_json = ? WHERE id = ?").run(JSON.stringify(damaged), saved.id);
    expect(gameRepository.get(saved.id)?.review).toBeNull();
    expect(gameRepository.get(saved.id)?.moveTree.length).toBeGreaterThan(1);

    // A review of other moves than the PGN's: dropped, not attached to the wrong ones.
    const wrong = { ...review, moves: review.moves.map((move) => ({ ...move, fenAfter: "8/8/8/8/8/8/8/8 w - - 0 1" })) };
    getDb().prepare("UPDATE games SET review_json = ? WHERE id = ?").run(JSON.stringify(wrong), saved.id);
    expect(gameRepository.get(saved.id)?.review).toBeNull();
  });

  it("rebuilds a tree whose links point at missing moves", () => {
    const saved = saveImported();
    const broken = saved.moveTree.slice(0, -1);
    getDb().prepare("UPDATE games SET move_tree_json = ? WHERE id = ?").run(JSON.stringify(broken), saved.id);
    expect(gameRepository.get(saved.id)?.moveTree).toHaveLength(saved.moveTree.length);
  });

  it("rebuilds a tree with a duplicate child, a cycle, a stray move or a missing field", () => {
    const saved = saveImported();
    const [root, e4, e5, nf3] = saved.moveTree;
    const damaged = [
      // e4 listed twice under the root.
      [{ ...root, children: [e4.id, e4.id] }, e4, e5, nf3],
      // e5 and Nf3 point at each other, apart from the root's line.
      [{ ...root, children: [e4.id] }, { ...e4, children: [] }, { ...e5, parentId: nf3.id }, { ...nf3, children: [e5.id] }],
      // Nf3 isn't anyone's child.
      [root, e4, { ...e5, children: [] }, nf3],
      // e5 has no SAN.
      [root, e4, { ...e5, san: undefined }, nf3],
      // The root isn't the canonical one.
      [{ ...root, id: "start" }, { ...e4, parentId: "start" }, e5, nf3]
    ];
    for (const tree of damaged) {
      getDb().prepare("UPDATE games SET move_tree_json = ? WHERE id = ?").run(JSON.stringify(tree), saved.id);
      const reopened = gameRepository.get(saved.id)!;
      expect(reopened.moveTree.filter((node) => node.san).map((node) => node.san)).toEqual(["e4", "e5", "Nf3"]);
      expect(reopened.moveTree.map((node) => node.id)).not.toEqual(saved.moveTree.map((node) => node.id));
    }
  });

  it("opens a stored tree as it is when it's well formed", () => {
    const saved = saveImported();
    expect(gameRepository.get(saved.id)?.moveTree).toEqual(saved.moveTree);
  });

  it("drops stored headers with a value that isn't text, for the PGN's", () => {
    const saved = saveImported();
    getDb().prepare("UPDATE games SET headers_json = ? WHERE id = ?").run(JSON.stringify({ white: 1 }), saved.id);
    expect(gameRepository.get(saved.id)?.headers).toBeNull();
    getDb()
      .prepare("UPDATE games SET headers_json = ? WHERE id = ?")
      .run(JSON.stringify({ white: "Carlsen", eco: null, orientationHint: "black" }), saved.id);
    expect(gameRepository.get(saved.id)?.headers).toEqual({ white: "Carlsen", eco: null, orientationHint: "black" });
  });

  it("refuses to open a game whose PGN would rebuild only part of the tree", () => {
    const saved = saveImported();
    getDb()
      .prepare("UPDATE games SET move_tree_json = '[]', pgn = ? WHERE id = ?")
      .run("1. e4 e5 2. Ke3 Nc6 *", saved.id);
    expect(() => gameRepository.get(saved.id)).toThrow(/damaged/);
  });

  it("refuses to open a game whose tree and PGN are both damaged", () => {
    const saved = saveImported();
    getDb().prepare("UPDATE games SET move_tree_json = '[]', pgn = '' WHERE id = ?").run(saved.id);
    expect(() => gameRepository.get(saved.id)).toThrow(/damaged/);
  });
});
