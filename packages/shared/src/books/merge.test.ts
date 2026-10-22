import { describe, expect, it } from "vitest";
import type { MoveNode } from "../types/chess";
import { exportRepertoirePgn, parseRepertoirePgn } from "../chess/repertoire-pgn";
import { START_FEN } from "../chess/position";
import type { BookLine, BookPageLines } from "./llm-output";
import { legalSans, mergeBookChapter, type BookMergePage } from "./merge";
import { bookPageOf, stripBookPage } from "./book-page";

// Synthetic lines (no book text): short openings with made-up notes.
function line(moves: string, extra: Partial<BookLine> = {}): BookLine {
  return { label: null, kind: "variation", role: "opponent", moves, notes: [], ...extra };
}

function page(pageIndex: number, lines: BookLine[], game: BookPageLines["game"] = null) {
  return { pageIndex, printedPage: pageIndex + 10, lines: { game, lines } } satisfies BookMergePage;
}

/** Each node by its path of SAN moves from the start ("e4 c5 Nf3"). */
function byPath(tree: readonly MoveNode[]): Map<string, MoveNode> {
  const nodes = new Map(tree.map((node) => [node.id, node]));
  const paths = new Map<string, MoveNode>();
  const walk = (node: MoveNode, path: string[]) => {
    for (const id of node.children) {
      const child = nodes.get(id)!;
      const next = [...path, child.san!];
      paths.set(next.join(" "), child);
      walk(child, next);
    }
  };
  walk(nodes.get("root")!, []);
  return paths;
}

const sansOf = (tree: readonly MoveNode[], node: MoveNode) =>
  node.children.map((id) => tree.find((candidate) => candidate.id === id)!.san);

describe("mergeBookChapter", () => {
  const pages = [
    page(
      0,
      [
        line("1. e4 c5 2. Nf3 d6 3. d4", {
          kind: "main",
          role: "own-recommended",
          notes: [{ after: "2. Nf3", text: "Develops first.", symbols: "!" }]
        }),
        line("1. e4 c5 2. Nf3 Nc6 3. Bb5", { label: "a" }),
        line("1. e4 c5 2. Nc3?! Nc6", { label: "b", role: "own-alternative" })
      ],
      { white: "Alpha", black: "Beta", event: "Test Open", year: "2001" }
    ),
    page(1, [
      line("1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4", {
        kind: "main",
        role: "own-recommended",
        notes: [{ after: "3... cxd4", text: "The usual capture.", symbols: null }]
      })
    ])
  ];
  const result = mergeBookChapter({ color: "white", pages });
  const nodes = byPath(result.tree);
  const node = (path: string) => nodes.get(path)!;

  it("merges full lines from move 1 into one tree and counts the chapter", () => {
    expect([...nodes.keys()]).toStrictEqual([
      "e4",
      "e4 c5",
      "e4 c5 Nf3",
      "e4 c5 Nf3 d6",
      "e4 c5 Nf3 d6 d4",
      "e4 c5 Nf3 d6 d4 cxd4",
      "e4 c5 Nf3 d6 d4 cxd4 Nxd4",
      "e4 c5 Nf3 Nc6",
      "e4 c5 Nf3 Nc6 Bb5",
      "e4 c5 Nc3",
      "e4 c5 Nc3 Nc6"
    ]);
    expect(result.report).toMatchObject({
      lines: 4,
      legalLines: 4,
      illegalLines: [],
      moves: 11,
      notesAnchored: 2,
      notesUnanchored: 0
    });
    expect(result.failures).toStrictEqual([]);
  });

  it("orders the main line first, then recommended moves, then rejected ones", () => {
    expect(sansOf(result.tree, node("e4 c5"))).toStrictEqual(["Nf3", "Nc3"]);
    expect(sansOf(result.tree, node("e4 c5 Nf3"))).toStrictEqual(["d6", "Nc6"]);
  });

  it("makes the side's moves included (rejected ones reference) and the opponent's covered", () => {
    const edge = (path: string) => result.nodeMeta[node(path).id]?.edge;
    expect(edge("e4")).toBe("included");
    expect(edge("e4 c5")).toBe("covered");
    expect(edge("e4 c5 Nc3")).toBe("reference");
    expect(edge("e4 c5 Nf3 Nc6 Bb5")).toBe("included");
    expect(result.nodeMeta.root).toBeUndefined();
  });

  it("links moves to the PDF page that first printed them and puts the game on its first move", () => {
    expect(node("e4").comment).toBe("[%page 1] Game: Alpha–Beta, Test Open 2001");
    expect(node("e4 c5").comment).toBeNull();
    expect(node("e4 c5 Nf3 d6 d4").comment).toBeNull();
    expect(node("e4 c5 Nf3 d6 d4 cxd4").comment).toBe("[%page 2] The usual capture.");
    expect(bookPageOf(node("e4 c5 Nf3 d6 d4 cxd4 Nxd4").comment)).toBeNull();
  });

  it("turns notes into comments and annotation symbols into NAGs", () => {
    expect(node("e4 c5 Nf3")).toMatchObject({ comment: "Develops first.", nags: ["$1"] });
    expect(node("e4 c5 Nc3").nags).toStrictEqual(["$6"]);
  });

  it("builds a tree the chapter store accepts: ids, links, plies, FENs and castling", () => {
    const castled = mergeBookChapter({
      color: "black",
      pages: [page(0, [line("1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. 0-0 Bc5", { kind: "main" })])]
    });
    const castling = castled.tree.find((candidate) => candidate.san === "O-O")!;
    expect(castling).toMatchObject({ uci: "e1g1", ply: 7 });
    expect(castled.tree[0]).toMatchObject({ id: "root", fenAfter: START_FEN, ply: 0 });
    expect(castled.nodeMeta[castling.id]).toStrictEqual({ edge: "covered" });
  });

  it("round-trips page commands through PGN export and import, outside the prose", () => {
    const pgn = exportRepertoirePgn([
      { title: "Chapter", headers: {}, rootFen: START_FEN, tree: result.tree }
    ]);
    const [game] = parseRepertoirePgn(pgn).games;
    const capture = byPath(game.tree).get("e4 c5 Nf3 d6 d4 cxd4")!;
    expect(bookPageOf(capture.comment)).toBe(2);
    expect(stripBookPage(capture.comment)).toBe("The usual capture.");
  });
});

describe("mergeBookChapter: hard cases", () => {
  const opening =
    "1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6 5. Nc3 d6 6. d3 O-O 7. Be3 Be6 8. Qe2 a6";

  it("takes the rook after which the rest of the line stays legal", () => {
    const result = mergeBookChapter({
      color: "white",
      pages: [page(0, [line(`${opening} 9. Rd1 b5 10. Rf1`)])]
    });
    const rook = result.tree.find((candidate) => candidate.ply === 17)!;
    expect(rook).toMatchObject({ san: "Rfd1", uci: "f1d1" });
    expect(result.report).toMatchObject({ disambiguated: 1, ambiguousGuesses: 0, legalLines: 1 });
  });

  it("guesses the nearest piece when looking ahead can't decide, and counts it", () => {
    const result = mergeBookChapter({
      color: "white",
      pages: [page(0, [line(`${opening} 9. Rd1`)])]
    });
    expect(result.tree.at(-1)).toMatchObject({ san: "Rfd1" });
    expect(result.report).toMatchObject({ disambiguated: 0, ambiguousGuesses: 1 });
  });

  it("keeps an illegal line's legal start and reports where it broke, for repair", () => {
    const result = mergeBookChapter({
      color: "white",
      pages: [
        page(3, [
          line("1. e4 c5 2. Nf3 d6 3. Bxh7 Nf6", {
            label: "c2",
            repairAttempts: 1,
            repairedFrom: "1. e4 c5 2. Nf3 d6 3. Bxh8"
          })
        ])
      ]
    });
    expect(result.tree.map((candidate) => candidate.san)).toStrictEqual([
      null,
      "e4",
      "c5",
      "Nf3",
      "d6"
    ]);
    expect(result.failures).toStrictEqual([
      {
        pageIndex: 3,
        printedPage: 13,
        label: "c2",
        error: 'illegal or unreadable move "Bxh7" after 1. e4 c5 2. Nf3 d6',
        lineIndex: 0,
        moves: "1. e4 c5 2. Nf3 d6 3. Bxh7 Nf6",
        fenBefore: "rnbqkbnr/pp2pppp/3p4/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3",
        token: "Bxh7",
        ply: 4,
        kind: "variation",
        repairAttempts: 1
      }
    ]);
    expect(result.report).toMatchObject({
      lines: 1,
      legalLines: 0,
      repairedLines: 1,
      illegalLines: [{ pageIndex: 3, printedPage: 13, label: "c2" }]
    });
  });

  it("anchors notes by number and colour, by move alone when unnumbered, and counts misses", () => {
    const result = mergeBookChapter({
      color: "black",
      pages: [
        page(0, [
          line("1. d4 Nf6 2. c4 e6 3. Nf3 b6", {
            kind: "main",
            role: "own-recommended",
            notes: [
              { after: "2... e6", text: "Flexible.", symbols: null },
              { after: "b6", text: "", symbols: "!?" },
              { after: "3. Nc3", text: "Not played here.", symbols: null },
              { after: "1. Nf6", text: "Wrong colour.", symbols: null }
            ]
          })
        ])
      ]
    });
    const bySan = (san: string) => result.tree.find((candidate) => candidate.san === san)!;
    expect(stripBookPage(bySan("e6").comment)).toBe("Flexible.");
    expect(bySan("b6").nags).toStrictEqual(["$5"]);
    expect(bySan("d4").comment).toBe("[%page 1]");
    expect(bySan("Nf6").comment).toBeNull();
    expect(result.report).toMatchObject({ notesAnchored: 2, notesUnanchored: 2 });
  });

  it("counts the moves printed on each page that the tree has, and unreadable pages", () => {
    const result = mergeBookChapter({
      color: "white",
      pages: [
        {
          ...page(0, [line("1. e4 c5 2. Nf3")]),
          ocrText: "**1 e4 c5 2 Nf3** and also 2 Nc3 or 2 0-0?!\n[PAGE 10]"
        },
        { ...page(1, []), unreadable: true }
      ]
    });
    expect(result.report.coverage).toStrictEqual({ printed: 5, found: 3 });
    expect(result.report.unreadablePages).toStrictEqual([1]);
  });

  it("skips lines without moves and cuts long comments to the store's limit", () => {
    const note = "x".repeat(200);
    const result = mergeBookChapter({
      color: "white",
      maxCommentLength: 100,
      pages: [
        page(0, [
          line("  "),
          line("1. e4", { notes: [{ after: "1. e4", text: note, symbols: null }] })
        ])
      ]
    });
    expect(result.report.lines).toBe(1);
    expect(result.tree[1].comment!.length).toBeLessThanOrEqual(100);
  });
});

describe("legalSans", () => {
  it("lists the legal moves in SAN, promotions included", () => {
    expect(legalSans("8/P7/8/8/8/8/8/k6K w - - 0 1")).toStrictEqual([
      "Kg1",
      "Kg2",
      "Kh2",
      "a8=B",
      "a8=N",
      "a8=Q+",
      "a8=R+"
    ]);
  });
});
