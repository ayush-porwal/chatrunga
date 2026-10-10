import { describe, expect, it } from "vitest";
import {
  localDateKey,
  msUntilNextDay,
  positionsDue,
  puzzleDetail,
  puzzleTitle,
  repertoireCardContent,
  repertoireMoveLabel,
  repertoireTitle
} from "./board-card-text";

describe("Repertoire card text", () => {
  it("writes the opponent's move as on a scoresheet", () => {
    const black = { uci: "g8f6", san: "Nf6", moveNumber: 3, color: "black" as const };
    const white = { uci: "f1c4", san: "Bc4", moveNumber: 4, color: "white" as const };
    expect(repertoireMoveLabel(black)).toBe("3…Nf6");
    expect(repertoireMoveLabel(white)).toBe("4. Bc4");
  });

  it("has no move before yours at a chapter root", () => {
    expect(repertoireMoveLabel(null)).toBeNull();
  });

  it("names the repertoire with its colour and counts positions due", () => {
    expect(repertoireTitle("Italian Game", "white")).toBe("Italian Game · White");
    expect(repertoireTitle("Caro-Kann", "black")).toBe("Caro-Kann · Black");
    expect(positionsDue(12)).toBe("12 positions due");
    expect(positionsDue(1)).toBe("1 position due");
  });
});

describe("repertoireCardContent", () => {
  const next = {
    repertoireId: "italian",
    repertoireName: "Italian Game",
    color: "white" as const,
    dueCount: 9,
    chapterId: "c1",
    nodeId: "n1",
    fen: "start",
    lastMove: null
  };
  const resume = {
    repertoireId: "caro",
    sessionId: "s1",
    mode: "review-due" as const,
    repertoireName: "Caro-Kann",
    color: "black" as const
  };
  const study = (repertoireId: string) => ({
    repertoireId,
    chapterId: "c2",
    nodeId: "n2",
    repertoireName: "Caro-Kann",
    color: "black" as const,
    chapterTitle: "Advance",
    fen: "study-fen"
  });
  const empty = { dueCount: 0, next: null, alsoDue: null, resume: null, continue: null };

  it("offers the next due position first, with every position due", () => {
    const alsoDue = { repertoireId: "caro", name: "Caro-Kann", dueCount: 3 };
    expect(
      repertoireCardContent({
        ...empty,
        dueCount: 12,
        next,
        alsoDue,
        resume,
        continue: study("caro")
      })
    ).toEqual({ kind: "review", next, dueCount: 12, alsoDue });
  });

  it("then an unfinished session, on its study position only when it is the same repertoire", () => {
    expect(repertoireCardContent({ ...empty, resume, continue: study("caro") })).toEqual({
      kind: "resume",
      resume,
      fen: "study-fen"
    });
    expect(repertoireCardContent({ ...empty, resume, continue: study("other") })).toMatchObject({
      kind: "resume",
      fen: null
    });
  });

  it("then the last study place, else nothing", () => {
    expect(repertoireCardContent({ ...empty, continue: study("caro") })).toEqual({
      kind: "study",
      target: study("caro")
    });
    expect(repertoireCardContent(empty)).toBeNull();
    expect(repertoireCardContent(undefined)).toBeNull();
  });
});

describe("Puzzle of the day text", () => {
  it("says whose move it is and the rating, or the difficulty without one", () => {
    expect(puzzleTitle({ sideToMove: "black" })).toBe("Black to move");
    expect(puzzleTitle({ sideToMove: "white" })).toBe("White to move");
    expect(puzzleDetail({ rating: 1724.4, difficulty: 3 })).toBe("Rating 1724");
    expect(puzzleDetail({ rating: null, difficulty: 3 })).toBe("Difficulty 3");
    expect(puzzleDetail({})).toBeNull();
  });

  it("keys the day by the local date and waits until local midnight for the next", () => {
    const evening = new Date(2026, 9, 9, 23, 59, 30);
    expect(localDateKey(evening)).toBe("2026-10-09");
    expect(localDateKey(new Date(2026, 0, 2, 0, 0, 1))).toBe("2026-01-02");
    expect(msUntilNextDay(evening)).toBe(30_000);
  });
});
