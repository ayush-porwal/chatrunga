import { describe, expect, it } from "vitest";
import { START_FEN } from "./position";
import { parsePgn, emptyHeaders } from "chessops/pgn";
import {
  createRepertoirePgnReader,
  exportRepertoirePgn,
  parseRepertoirePgn
} from "./repertoire-pgn";

const TWO_GAMES = `[Event "Sicilian: Najdorf"]
[Site "https://lichess.org/study/abc"]
[White "?"]
[Black "?"]
[Result "*"]
[ECO "B90"]
[StudyName "My Sicilian"]
[Annotator "me"]

{ Main ideas. [%csl Gd5] } 1. e4 c5 2. Nf3 $1 { Open Sicilian [%cal Gd2d4] } (2. c3 d5 (2... Nf6 3. e5) 3. exd5) 2... d6 3. d4 *

[Event "?"]
[White "Alice"]
[Black "Bob"]

1. d4 d5 2. c4 *
`;

describe("parseRepertoirePgn", () => {
  it("parses every game with all tags and stable ids", () => {
    const { games } = parseRepertoirePgn(TWO_GAMES);
    expect(games).toHaveLength(2);
    const [first, second] = games;
    expect(first.proposedTitle).toBe("Sicilian: Najdorf");
    expect(first.headers).toMatchObject({ ECO: "B90", StudyName: "My Sicilian", Annotator: "me" });
    expect(first.rootFen).toBe(START_FEN);
    expect(first.tree[0].id).toBe("root");
    expect(first.tree.slice(1).map((node) => node.id)).toEqual(
      first.tree.slice(1).map((_, index) => `n${index + 1}`)
    );
    expect(first.nodeCount).toBe(first.tree.length - 1);
    expect(second.proposedTitle).toBe("Alice – Bob");
    expect(second.index).toBe(1);
    // Parsing again yields the same ids.
    expect(parseRepertoirePgn(TWO_GAMES).games[0].tree).toEqual(first.tree);
  });

  it("keeps nested variations, comments, NAGs, arrows and highlights", () => {
    const [game] = parseRepertoirePgn(TWO_GAMES).games;
    const bySan = (san: string) => game.tree.filter((node) => node.san === san);
    const root = game.tree[0];
    expect(root.comment).toBe("Main ideas.");
    expect(root.highlights).toEqual([{ color: "green", square: "d5" }]);
    const nf3 = bySan("Nf3")[0];
    expect(nf3.nags).toEqual(["$1"]);
    expect(nf3.comment).toBe("Open Sicilian");
    expect(nf3.arrows).toEqual([{ color: "green", orig: "d2", dest: "d4" }]);
    const c5 = bySan("c5")[0];
    expect(c5.children.map((id) => game.tree.find((n) => n.id === id)?.san)).toEqual(["Nf3", "c3"]);
    const c3 = bySan("c3")[0];
    expect(c3.children.map((id) => game.tree.find((n) => n.id === id)?.san)).toEqual(["d5", "Nf6"]);
    expect(bySan("e5")[0].parentId).toBe(bySan("Nf6")[0].id);
  });

  it("reports an illegal branch with its path and keeps the rest", () => {
    const { games } = parseRepertoirePgn(
      "1. e4 e5 2. Nf3 (2. Ke3 Nc6) 2... Nc6 3. Bb5 (3. Qxf7) *"
    );
    const [game] = games;
    // Depth-first, main line first.
    expect(game.invalidBranches).toEqual([
      { path: "1. e4 e5 2. Nf3 Nc6", san: "Qxf7", reason: expect.stringMatching(/Not a legal/) },
      { path: "1. e4 e5", san: "Ke3", reason: expect.any(String) }
    ]);
    expect(game.tree.map((node) => node.san)).toEqual([null, "e4", "e5", "Nf3", "Nc6", "Bb5"]);
  });

  it("merges a duplicated variation with a warning", () => {
    const [game] = parseRepertoirePgn("1. e4 (1. e4 c5) 1... e5 *").games;
    expect(game.tree.map((node) => node.san)).toEqual([null, "e4", "e5", "c5"]);
    expect(game.warnings).toEqual([expect.stringMatching(/Duplicate variation 1\. e4/)]);
  });

  it("rejects other variants and bad FEN tags without dropping the game silently", () => {
    const { games } = parseRepertoirePgn(
      `[Variant "Atomic"]\n\n1. e4 *\n\n[Variant "Standard"]\n\n1. d4 *\n\n[SetUp "1"]\n[FEN "bad"]\n\n*\n\n[Variant "From Position"]\n[FEN "8/8/8/8/8/8/4k3/4K3 w - - 0 1"]\n\n*`
    );
    expect(games.map((game) => game.rejected)).toEqual([
      expect.stringMatching(/Unsupported variant "Atomic"/),
      null,
      expect.stringMatching(/Invalid starting position/),
      expect.stringMatching(/Invalid starting position/)
    ]);
    expect(games[0].warnings).toEqual([games[0].rejected]);
    expect(games[0].nodeCount).toBe(0);
    expect(games[1].nodeCount).toBe(1);
  });

  it("enforces limits with actionable errors", () => {
    expect(() => parseRepertoirePgn("")).toThrow(/No PGN game/);
    expect(() => parseRepertoirePgn(TWO_GAMES, { maxGames: 1 })).toThrow(/at most 1\b.*Split/);
    expect(() => parseRepertoirePgn(TWO_GAMES, { maxNodes: 5 })).toThrow(/more than 5 moves/);
    expect(() => parseRepertoirePgn("1. e4 e5 2. Nf3 Nc6 *", { maxDepth: 3 })).toThrow(
      /longer than 3 moves \(at 1\. e4 e5 2\. Nf3\)/
    );
    const long = "x".repeat(30);
    expect(parseRepertoirePgn(`1. e4 { ${long} } *`).games[0].tree[1].comment).toBe(long);
  });

  it("rejects only the game with a comment over the limit, and the rest still imports", () => {
    const long = "x".repeat(30);
    const pgn = `1. e4 e5 { ${long} } *\n\n{ ${long} } 1. e4 *\n\n1. d4 d5 *`;
    const { games } = parseRepertoirePgn(pgn, { maxCommentLength: 20, maxNodes: 3 });
    expect(games.map((game) => game.rejected)).toEqual([
      "a comment is longer than 20 characters (at 1. e4 e5)",
      "a comment is longer than 20 characters (at the start)",
      null
    ]);
    expect(games[0].warnings).toEqual([games[0].rejected]);
    expect(games[0].nodeCount).toBe(0);
    // The rejected games' moves don't count toward the move limit (3 here).
    expect(games[2].nodeCount).toBe(2);
  });

  it("measures a comment's length after its annotation tags are read out", () => {
    const arrows = Array.from({ length: 40 }, () => "Ge2e4").join(",");
    const pgn = `1. e4 { [%cal ${arrows}] [%csl Rd4] [%clk 0:05:00] short note } *`;
    const [game] = parseRepertoirePgn(pgn, { maxCommentLength: 20 }).games;
    expect(game.rejected).toBeNull();
    expect(game.tree[1].comment).toBe("short note");
    expect(game.tree[1].arrows).toHaveLength(40);
  });

  it("reads games one at a time with the same result and limits across games", () => {
    const reader = createRepertoirePgnReader();
    for (const game of parsePgn(TWO_GAMES, emptyHeaders)) reader.push(game);
    expect(reader.gamesSeen).toBe(2);
    expect(reader.nodesSeen).toBe(
      parseRepertoirePgn(TWO_GAMES).games.reduce((n, g) => n + g.nodeCount, 0)
    );
    expect(reader.finish()).toEqual(parseRepertoirePgn(TWO_GAMES));

    // The game limit fails on the first game past it, before later games are parsed.
    const limited = createRepertoirePgnReader({ maxGames: 1 });
    const [first, second] = parsePgn(TWO_GAMES, emptyHeaders);
    limited.push(first);
    expect(() => limited.push(second)).toThrow(
      "This PGN has more than 1 games; one import can hold at most 1. Split the file and import it in parts."
    );
    expect(() => createRepertoirePgnReader().finish()).toThrow("No PGN game found.");
  });

  it("titles untitled games by position", () => {
    expect(parseRepertoirePgn("1. e4 *").games[0].proposedTitle).toBe("Chapter 1");
  });
});

describe("exportRepertoirePgn", () => {
  it("writes one game per chapter with retained tags, annotations and variations", () => {
    const parsed = parseRepertoirePgn(TWO_GAMES).games;
    const pgn = exportRepertoirePgn(
      parsed.map((game, index) => ({
        title: index === 0 ? "Najdorf" : "QGD",
        headers: game.headers,
        rootFen: game.rootFen,
        tree: game.tree
      }))
    );
    expect(pgn).toBe(`[Event "Najdorf"]
[Site "https://lichess.org/study/abc"]
[White "?"]
[Black "?"]
[Result "*"]
[ECO "B90"]
[StudyName "My Sicilian"]
[Annotator "me"]

{ Main ideas. [%csl Gd5] } 1. e4 c5 2. Nf3 $1 { Open Sicilian [%cal Gd2d4] } (2. c3 d5 (2... Nf6 3. e5) 3. exd5) 2... d6 3. d4 *

[Event "QGD"]
[White "Alice"]
[Black "Bob"]
[Result "*"]

1. d4 d5 2. c4 *
`);
    const reparsed = parseRepertoirePgn(pgn).games;
    expect(reparsed.map((game) => game.tree)).toEqual(parsed.map((game) => game.tree));
  });

  it("round-trips a custom Black-to-move root with SetUp/FEN and numbering", () => {
    const fen = "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1";
    const source = `[Event "Black vs 1.d4"]\n[SetUp "1"]\n[FEN "${fen}"]\n\n1... Nf6 2. c4 (2. Nf3 g6) 2... e6 *`;
    const [game] = parseRepertoirePgn(source).games;
    expect(game.rootFen).toBe(fen);
    expect(game.tree[1].ply).toBe(2);
    const pgn = exportRepertoirePgn([
      { title: "Indian", headers: game.headers, rootFen: game.rootFen, tree: game.tree }
    ]);
    expect(pgn).toContain(`[SetUp "1"]\n[FEN "${fen}"]`);
    expect(pgn).toContain("1... Nf6 2. c4 (2. Nf3 g6) 2... e6 *");
    expect(pgn.match(/\[FEN /g)).toHaveLength(1);
    expect(parseRepertoirePgn(pgn).games[0].tree).toEqual(game.tree);
  });

  it("defaults Result to * and escapes tag values", () => {
    const [game] = parseRepertoirePgn("1. e4 *").games;
    const pgn = exportRepertoirePgn([
      {
        title: 'The "Best" \\ line',
        headers: { Result: "" },
        rootFen: game.rootFen,
        tree: game.tree
      }
    ]);
    expect(pgn).toBe('[Event "The \\"Best\\" \\\\ line"]\n[Result "*"]\n\n1. e4 *\n');
  });

  it("writes an empty chapter as just its result", () => {
    const [game] = parseRepertoirePgn('[Event "x"]\n\n*').games;
    expect(
      exportRepertoirePgn([{ title: "Empty", headers: {}, rootFen: game.rootFen, tree: game.tree }])
    ).toBe('[Event "Empty"]\n[Result "*"]\n\n*\n');
  });
});
