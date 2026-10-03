import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRepertoirePgn } from "@chaturanga/shared/chess/repertoire-pgn";
import { validateTree } from "./chapter-validation";
import { runImport } from "./import-job";

/**
 * An independent check of the import parse: `parse-regression.json` holds what the synchronous
 * parser gave for `parse-regression.pgn` before parsing moved to the worker (verified by hand to
 * differ only in castling, now stored as king-to-square, e.g. e1g1), so a change to the streaming
 * splitter, the reader or the validation shows up here even when both paths change together.
 */
const fixtures = join(__dirname, "__fixtures__");
const pgn = readFileSync(join(fixtures, "parse-regression.pgn"), "utf8");
const snapshot = JSON.parse(readFileSync(join(fixtures, "parse-regression.json"), "utf8"));

describe("import parse regression fixture", () => {
  it("covers CRLF, castling, promotion, custom roots and rejected games", () => {
    expect(pgn).toContain("\r\n");
    expect(snapshot).toHaveLength(8);
  });

  it("the worker's parse gives the snapshot, whatever the chunk size", async () => {
    for (const chunkChars of [1, 7, 64, 32 * 1024]) {
      const { games } = await runImport({ kind: "text", text: pgn }, undefined, { chunkChars });
      const parsed = games.map(({ positionKeys, ...game }) => {
        expect(Object.keys(positionKeys)).toHaveLength(game.rejected ? 0 : game.tree.length);
        return game;
      });
      expect(parsed).toEqual(snapshot);
    }
  });

  it("the synchronous parser gives the snapshot once its trees are validated", () => {
    const games = parseRepertoirePgn(pgn).games.map((game) => ({
      ...game,
      tree: game.rejected ? game.tree : validateTree(game.tree, game.rootFen)
    }));
    expect(games).toEqual(snapshot);
  });
});
