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

  it("rebuilds a tree whose links point at missing moves", () => {
    const saved = saveImported();
    const broken = saved.moveTree.slice(0, -1);
    getDb().prepare("UPDATE games SET move_tree_json = ? WHERE id = ?").run(JSON.stringify(broken), saved.id);
    expect(gameRepository.get(saved.id)?.moveTree).toHaveLength(saved.moveTree.length);
  });

  it("refuses to open a game whose tree and PGN are both damaged", () => {
    const saved = saveImported();
    getDb().prepare("UPDATE games SET move_tree_json = '[]', pgn = '' WHERE id = ?").run(saved.id);
    expect(() => gameRepository.get(saved.id)).toThrow(/damaged/);
  });

  it("lists summaries through the recent-games index and counts without reading rows", () => {
    saveImported();
    const plan = getDb()
      .prepare("EXPLAIN QUERY PLAN SELECT id FROM games WHERE source != 'puzzle' ORDER BY updated_at DESC, id")
      .all() as { detail: string }[];
    expect(plan.map((row) => row.detail).join(" ")).toContain("games_recent_idx");
    expect(gameRepository.count()).toBe(1);
    expect(gameRepository.idsBySource("pgn-import")).toHaveLength(1);
  });
});
