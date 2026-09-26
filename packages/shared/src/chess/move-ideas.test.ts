import { describe, expect, it } from "vitest";
import { buildIdeaFacts, lineOutcome } from "./move-ideas";
import { describeBoard, exchangeGain, positionSnapshot } from "./position-features";
import { positionFromFen } from "./position";
import { parseSquare } from "chessops/util";

describe("buildIdeaFacts", () => {
  // White: Kh1 Qd1 Rf1 g2 h2; Black: Kg8 Ba6 f7 g7 h7. The queen is the only
  // guard of the rook on f1 against the bishop on a6.
  const abandonFen = "6k1/5ppp/b7/8/8/8/6PP/3Q1R1K w - - 0 20";

  it("explains a move that abandons the defence of a piece and what the reply exploits", () => {
    const ideas = buildIdeaFacts({
      fenBefore: abandonFen,
      playedUci: "d1d4",
      bestUci: "f1e1",
      bestLine: ["f1e1", "g7g6"],
      replyLine: ["a6f1", "d4d8"]
    });
    expect(ideas).not.toBeNull();
    expect(ideas!.board.white).toBe("K h1; Q d1; R f1; P g2 h2");
    expect(ideas!.played.san).toBe("Qd4");
    expect(ideas!.played.facts).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^stops protecting the rook on f1 \(the queen used to guard it; attacked by the bishop on a6, undefended\)/
        )
      ])
    );
    expect(ideas!.reply?.san).toBe("Bxf1");
    expect(ideas!.reply?.facts[0]).toBe("takes the rook on f1, which Qd4 stopped defending");
    expect(
      ideas!.reply?.facts.some((fact) =>
        fact.startsWith("reply line: over 2 plies Black wins a rook")
      )
    ).toBe(true);
    expect(ideas!.best?.san).toBe("Re1");
    expect(ideas!.best?.facts[0]).toBe("moves the rook out of danger from the bishop on a6");
  });

  it("detects a fork and the follow-up capture in the main line", () => {
    const ideas = buildIdeaFacts({
      fenBefore: "r3k3/8/8/3N4/8/8/8/6K1 w - - 0 1",
      playedUci: "d5c7",
      bestUci: "d5c7",
      bestLine: ["d5c7", "e8d7", "c7a8"]
    });
    expect(ideas!.played.facts).toEqual(
      expect.arrayContaining([
        "gives check",
        "forks the rook on a8 and the king on e8",
        "main line: over 3 plies White wins a rook for nothing",
        "sets up Nxa8 after Kd7, capturing the rook on a8"
      ])
    );
    expect(ideas!.best).toBeUndefined();
  });

  it("says what the best move attacks", () => {
    // 1.e4 e5 2.Nf3 Nc6 3.d3 Nd4?! — d3-d4 is not legal, so use c3 kicking the knight.
    const fen = "r1bqkbnr/pppp1ppp/8/4p3/3nP3/3P1N2/PPP2PPP/RNBQKB1R w KQkq - 2 4";
    const ideas = buildIdeaFacts({
      fenBefore: fen,
      playedUci: "b1d2",
      bestUci: "c2c3",
      bestLine: ["c2c3", "d4f3"]
    });
    expect(ideas!.best?.san).toBe("c3");
    expect(ideas!.best?.facts[0]).toBe("attacks the knight on d4 (defended once)");
    expect(ideas!.played.facts).toContain("develops the knight from b1");
    expect(ideas!.position?.after.material).toContain("material is level");
    expect(ideas!.position?.before.material).toBeUndefined();
  });

  it("notes a pin on a piece the move leaves loose, and ignores 'forks' by a piece that can be taken", () => {
    // Opera game after 14.Rd1: the d7 rook is pinned by the b5 bishop; 14...Qe6 does nothing about it.
    const fen = "4kb1r/p2rqppp/5n2/1B2p1B1/4P3/1Q6/PPP2PPP/2KR4 b k - 1 14";
    const ideas = buildIdeaFacts({
      fenBefore: fen,
      playedUci: "e7e6",
      bestUci: "e7d6",
      replyLine: ["b5d7", "e6d7"]
    })!;
    expect(ideas.played.facts).toContain(
      "does nothing for the rook on d7, which stays loose (pinned to the king by the bishop on b5; attacked by the rook on d1 and the bishop on b5, defended 3 times)"
    );
    // Bxd7+ hits the king and the queen, but the bishop is simply recaptured.
    expect(ideas.reply?.facts.some((fact) => fact.startsWith("forks"))).toBe(false);
    expect(ideas.reply?.facts[0]).toBe("takes the rook on d7");
  });

  it("returns null for an illegal move", () => {
    expect(buildIdeaFacts({ fenBefore: abandonFen, playedUci: "d1d8x" })).toBeNull();
    expect(buildIdeaFacts({ fenBefore: abandonFen, playedUci: "a1a2" })).toBeNull();
  });
});

describe("position features", () => {
  it("describes material imbalance, king safety and pawn structure", () => {
    const snapshot = positionSnapshot(
      "r1bq1rk1/pp3ppp/2n5/3p4/3P4/2N5/PP3PPP/R2QKB1R w KQ - 0 12",
      true
    )!.snapshot;
    expect(snapshot.white).toContain("king e1 (in the center)");
    expect(snapshot.white).toContain("can still castle short");
    expect(snapshot.white).toContain("isolated d4");
    expect(snapshot.black).toContain("king g8 (castled short side)");
    expect(snapshot.black).toContain("pawn shield f7 g7 h7");
    expect(snapshot.files).toContain("open: c e");
    expect(snapshot.material).toBe("White Q 2R B N 6P; Black Q 2R B N 6P; material is level");
  });

  it("computes static exchanges both ways", () => {
    // Pawn d5 attacked by the c3 knight, defended by the e6 pawn: not winnable.
    const defended = positionFromFen("4k3/8/4p3/3p4/8/2N5/8/4K3 w - - 0 1");
    expect(exchangeGain(defended, parseSquare("d5")!)).toBeLessThanOrEqual(0);
    // Knight d5 attacked by the e4 pawn, defended by a pawn: still wins material (3 for 1).
    const knight = positionFromFen("4k3/8/4p3/3n4/4P3/8/8/4K3 w - - 0 1");
    expect(exchangeGain(knight, parseSquare("d5")!)).toBe(2);
  });

  it("summarizes material over a line", () => {
    expect(lineOutcome("4k3/8/8/3n4/4P3/8/8/4K3 w - - 0 1", ["e4d5"])).toBe(
      "over 1 ply White wins a knight for nothing"
    );
    expect(describeBoard("not a fen")).toBeNull();
  });
});
