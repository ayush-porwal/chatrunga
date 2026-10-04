import { describe, expect, it } from "vitest";
import { puzzleInsightPayloadSchema } from "@chaturanga/shared/schemas/puzzle-insight";
import { tokenizeCommentary, type CommentaryMoveToken } from "../game-review/commentary-moves";
import { nonSolutionSan, solutionIndexForToken, type PuzzleProseLine } from "./puzzle-prose";

/** 24...Qxe1+ 25.Rxe1 Rxe1#: the same rook capture twice, then with mate (the FEN only sets the move numbers). */
const backRank: PuzzleProseLine = {
  fen: "4r1k1/5ppp/8/8/8/8/5PPP/4R1K1 b - - 0 24",
  solutionSan: ["Qxe1+", "Rxe1", "Rxe1#"],
  otherSan: []
};

/** The solution index each move of `text` links to (null: plain text). */
function links(text: string, line: PuzzleProseLine): Array<[string, number | null]> {
  return tokenizeCommentary(text)
    .filter((segment): segment is CommentaryMoveToken => segment.kind === "move")
    .map((token) => [token.text, solutionIndexForToken(token, line)]);
}

describe("solutionIndexForToken", () => {
  it("links each mention to the ply it names, the mate to the mate, whatever the order", () => {
    expect(links("Rxe1# ends it after Qxe1+ and Rxe1.", backRank)).toEqual([
      ["Rxe1#", 2],
      ["Qxe1+", 0],
      ["Rxe1", 1]
    ]);
  });

  it("links a move written without its check or mate only when that names one ply", () => {
    expect(links("Qxe1 removes the guard.", backRank)).toEqual([["Qxe1", 0]]);
    expect(links("Then Rxe1+ follows.", backRank)).toEqual([["Rxe1+", null]]);
  });

  it("uses a move number to tell a repeated move apart", () => {
    const repeated: PuzzleProseLine = {
      fen: "8/8/8/8/8/8/8/8 w - - 0 10",
      solutionSan: ["Nf7+", "Kg8", "Nh6+", "Kh8", "Nf7+"],
      otherSan: []
    };
    expect(links("Nf7+ keeps checking.", repeated)).toEqual([["Nf7+", null]]);
    expect(links("10. Nf7+ and 12. Nf7+ again, but 11. Nf7+ never.", repeated)).toEqual([
      ["10. Nf7+", 0],
      ["12. Nf7+", 4],
      ["11. Nf7+", null]
    ]);
    expect(links("24...Rxe1 and 25...Rxe1#.", backRank)).toEqual([
      ["24...Rxe1", null],
      ["25...Rxe1#", 2]
    ]);
  });

  it("doesn't link a move that may be the wrong move, its refutation or an alternative instead", () => {
    const line = { ...backRank, otherSan: ["Qxe1", "Rxe1"] };
    expect(links("Rxe1 and Qxe1+ and Rxe1#.", line)).toEqual([
      ["Rxe1", null],
      ["Qxe1+", 0],
      ["Rxe1#", 2]
    ]);
    expect(links("Qxe1 alone.", line)).toEqual([["Qxe1", null]]);
  });

  it("leaves moves that aren't in the solution as text", () => {
    expect(links("Kf8 runs.", backRank)).toEqual([["Kf8", null]]);
  });
});

describe("nonSolutionSan", () => {
  it("collects the wrong move, its refutation and the alternatives' lines", () => {
    const payload = puzzleInsightPayloadSchema.parse({
      schemaVersion: 1,
      player: { rating: 1500 },
      puzzle: {
        fen: backRank.fen,
        sideToMove: "black",
        moveNumberSan: "24...",
        themes: [],
        solutionSan: backRank.solutionSan
      },
      outcome: "failed_wrong_move",
      engine: {
        assessment: "black_has_forced_mate",
        bestMoveSan: "Qxe1+",
        bestLineSan: ["Qxe1+", "Rxe1", "Rxe1#"],
        alternatives: [{ rank: 2, san: "h6", lineSan: ["h6", "Rxe8+"] }]
      },
      mistake: {
        moveNumberSan: "24...",
        san: "Qd8",
        playedBeforeSan: [],
        solutionSan: "Qxe1+",
        fenBefore: backRank.fen,
        fenAfter: backRank.fen,
        refutationSan: ["Rxe8+", "Qxe8"]
      }
    });
    expect(nonSolutionSan(payload)).toEqual(["h6", "Rxe8+", "Qd8", "Qxe8"]);
    expect(
      nonSolutionSan({
        ...payload,
        outcome: "solved",
        mistake: undefined,
        engine: { ...payload.engine, alternatives: undefined }
      })
    ).toEqual([]);
  });
});
