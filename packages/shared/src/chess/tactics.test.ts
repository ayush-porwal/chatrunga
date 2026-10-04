import { describe, expect, it } from "vitest";
import { analyzeTacticsForPosition } from "./tactics";
import type { TacticalFact } from "../schemas/tactical-fact";

/**
 * Tactical motif fixture FENs — known positions where a specific motif is true
 * for the mover (the side whose move just landed). Tests run the detector and
 * assert the expected motif is found.
 *
 * Each fixture uses the side-NOT-to-move as the mover (i.e., they just played
 * a move that created the tactic, and now it's the opponent's turn).
 */

const findKind = <K extends TacticalFact["kind"]>(facts: TacticalFact[], kind: K) =>
  facts.find((f): f is Extract<TacticalFact, { kind: K }> => f.kind === kind);

describe("analyzeTacticsForPosition — hanging", () => {
  it("flags a hanging pawn with no defenders", () => {
    // White pawn on e4 is attacked by black knight on c5 with no defenders.
    // After black moved (e.g. Nc5), it's white's turn, and white has a hanging pawn.
    const fen = "rnbqkb1r/pppppppp/8/2n5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1";
    const facts = analyzeTacticsForPosition(fen, "white");
    expect(findKind(facts, "hanging")).toMatchObject({ piece: { square: "e4", role: "pawn" } });
  });

  it("does not flag a defended piece as hanging", () => {
    // Starting position: every pawn is defended. No piece hangs.
    const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const facts = analyzeTacticsForPosition(fen, "white");
    const hanging = facts.filter((f) => f.kind === "hanging");
    expect(hanging.length).toBe(0);
  });
});

describe("analyzeTacticsForPosition — fork", () => {
  it("flags a knight fork on king and queen", () => {
    // White knight on f7 forks the black king on g8 and black queen on d8.
    // Custom position — knight just landed on f7 attacking both.
    const fen = "2k1q3/8/3N4/8/8/8/8/K7 b - - 0 1";
    const facts = analyzeTacticsForPosition(fen, "white");
    const fork = findKind(facts, "fork");
    expect(fork).toMatchObject({ attacker: { role: "knight", square: "d6" } });
    const targetRoles = fork?.targets.map((t) => t.role);
    expect(targetRoles).toContain("queen");
    expect(targetRoles).toContain("king");
    // Sorted highest-value first
    expect(targetRoles?.[0]).toBe("king");
  });

  it("flags a knight fork on two minor pieces if one is undefended", () => {
    // White knight on e5 attacks black bishop on c6 and black rook on g6.
    // The bishop and rook have no defenders.
    const fen = "7k/8/2b3r1/4N3/8/8/8/4K3 b - - 0 1";
    const facts = analyzeTacticsForPosition(fen, "white");
    expect(findKind(facts, "fork")).toMatchObject({ attacker: { square: "e5" } });
  });
});

describe("analyzeTacticsForPosition — pin", () => {
  it("flags an absolute pin (piece in front of king)", () => {
    // White bishop on b3 pins black knight on e6 to the black king on g8.
    // a8-h1 diagonal: b3, c4, d5, e6, f7, g8.
    const fen = "6k1/8/4n3/8/8/1B6/8/4K3 b - - 0 1";
    const facts = analyzeTacticsForPosition(fen, "white");
    expect(findKind(facts, "pin")).toMatchObject({
      pinned: { square: "e6", role: "knight" },
      pinner: { square: "b3" },
      behind: { role: "king" }
    });
  });
});

describe("analyzeTacticsForPosition — skewer", () => {
  it("flags a skewer (king in front, rook behind)", () => {
    // White rook on a1 attacks black king on a8 with black rook on a5 behind ...
    // wait skewer = front higher value than behind. So king-front (high) skewers rook-behind.
    // Rook attacks down a-file: a8 king (front), a5 rook (behind? no, a5 between).
    // Setup: white rook a1, black king a8, black rook a4 — rook a1 hits king a8 with rook a4 between
    // That's pin (rook a4 pinned to king). For skewer we need king IN FRONT.
    // Setup: white rook a1, black king a4, black rook a8 — rook a1 hits king a4, behind a4 sits rook a8.
    const fen = "r7/8/8/8/k7/8/8/R3K3 b - - 0 1";
    const facts = analyzeTacticsForPosition(fen, "white");
    expect(findKind(facts, "skewer")).toMatchObject({
      attacker: { role: "rook" },
      front: { role: "king" },
      behind: { role: "rook" }
    });
  });
});

describe("analyzeTacticsForPosition — multiple motifs in one position", () => {
  it("returns an array of all detected motifs without duplication", () => {
    // Position with a clean fork: white knight on f7 attacks black king on g8 + queen on d8.
    const fen = "2k1q3/8/3N4/8/8/8/8/K7 b - - 0 1";
    const facts = analyzeTacticsForPosition(fen, "white");
    expect(facts.length).toBeGreaterThanOrEqual(1);
    // No duplicate fork entries for the same attacker.
    const forks = facts.filter((f) => f.kind === "fork");
    const forkSquares = new Set(forks.map((f) => f.kind === "fork" && f.attacker.square));
    expect(forkSquares.size).toBe(forks.length);
  });
});

describe("analyzeTacticsForPosition — regressions", () => {
  it("does not flag a pawn that is attacked once and defended by a pawn", () => {
    // Black pawn d5 attacked by the c3 knight, defended by e6: taking loses the knight.
    const facts = analyzeTacticsForPosition("4k3/8/4p3/3p4/8/2N5/8/4K3 b - - 0 1", "black");
    expect(facts.filter((f) => f.kind === "hanging")).toHaveLength(0);
  });

  it("does not flag an even pawn trade as hanging", () => {
    // White pawn e4 attacked by the d5 pawn and defended by the c3 knight: exd5-style trade is even.
    const facts = analyzeTacticsForPosition("4k3/8/8/3p4/4P3/2N5/8/4K3 w - - 0 1", "white");
    expect(facts.filter((f) => f.kind === "hanging")).toHaveLength(0);
  });

  it("flags a knight attacked by a pawn even when defended", () => {
    const facts = analyzeTacticsForPosition("4k3/8/4p3/3n4/4P3/8/8/4K3 b - - 0 1", "black");
    expect(facts.find((f) => f.kind === "hanging")).toMatchObject({
      piece: { role: "knight", square: "d5" }
    });
  });

  it("does not report a bishop 'pinning' the f7 pawn to a castled king", () => {
    // Italian-style: white bishop c4 eyes f7 with the king on g8 behind.
    const fen = "r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQ1RK1 b - - 0 6";
    expect(analyzeTacticsForPosition(fen, "white").filter((f) => f.kind === "pin")).toHaveLength(0);
  });

  it("reports the classic Bg5 pin of the f6 knight against the queen", () => {
    // The e7 square is empty, so the d8 queen sits behind the f6 knight on the g5-d8 diagonal.
    const fen = "rnbqkb1r/ppp2ppp/4pn2/3p2B1/2PP4/2N5/PP2PPPP/R2QKBNR b KQkq - 1 4";
    const pins = analyzeTacticsForPosition(fen, "white").filter((f) => f.kind === "pin");
    expect(pins).toEqual([
      {
        kind: "pin",
        pinned: { role: "knight", square: "f6" },
        pinner: { role: "bishop", square: "g5" },
        behind: { role: "queen", square: "d8" }
      }
    ]);
  });

  it("drops motifs that already existed before the move", () => {
    // The b3 bishop already pinned the e6 knight; a king move creates nothing new.
    const before = "6k1/8/4n3/8/8/1B6/8/4K3 w - - 0 1";
    const after = "6k1/8/4n3/8/8/1B6/8/3K4 b - - 1 1";
    expect(analyzeTacticsForPosition(after, "white").some((f) => f.kind === "pin")).toBe(true);
    expect(
      analyzeTacticsForPosition(after, "white", { fenBefore: before }).some((f) => f.kind === "pin")
    ).toBe(false);
  });
});
