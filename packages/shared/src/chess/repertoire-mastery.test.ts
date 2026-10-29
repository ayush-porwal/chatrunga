import { describe, expect, it } from "vitest";
import type { MoveNode } from "../types/chess";
import type { RepertoireChapter } from "../types/repertoire";
import { parseOpeningBook } from "./opening-book";
import { openingBookText } from "./opening-book-data";
import { fenAfterUci, START_FEN } from "./position";
import {
  deepestOpening,
  isLearned,
  lineFens,
  mainlineFens,
  MASTERED_INTERVAL_MS,
  masteryOf,
  perfectLineCount,
  practiceLines
} from "./repertoire-mastery";
import { positionKey } from "./repertoire-position";

const DAY = 24 * 60 * 60_000;
const NOW = Date.UTC(2026, 9, 29, 12);

/** A chapter tree from UCI lines (shared prefixes become one path; the first line is the mainline). */
function chapterOf(lines: string[][], patch: Partial<RepertoireChapter> = {}) {
  const root: MoveNode = {
    id: "root",
    parentId: null,
    san: null,
    uci: null,
    fenBefore: START_FEN,
    fenAfter: START_FEN,
    ply: 0,
    nags: [],
    comment: null,
    arrows: [],
    highlights: [],
    children: []
  };
  const tree = [root];
  for (const line of lines) {
    let parent = root;
    for (const uci of line) {
      let child = tree.find((node) => node.parentId === parent.id && node.uci === uci);
      if (!child) {
        child = {
          ...root,
          id: `n${tree.length}`,
          parentId: parent.id,
          uci,
          san: uci,
          fenBefore: parent.fenAfter,
          fenAfter: fenAfterUci(parent.fenAfter, uci)!,
          ply: parent.ply + 1,
          children: []
        };
        tree.push(child);
        parent.children.push(child.id);
      }
      parent = child;
    }
  }
  return { kind: "opening" as const, enabled: true, tree, nodeMeta: {}, ...patch };
}

const keyAfter = (moves: string[]) => positionKey(lineFens(START_FEN, moves).at(-1)!);

describe("mastery", () => {
  it("reads new, learning and mastered from the schedule", () => {
    expect(masteryOf(null)).toBe("new");
    expect(masteryOf({ stage: 0, dueAt: null, lastAttemptAt: null })).toBe("new");
    expect(masteryOf({ stage: 0, dueAt: NOW + 10 * 60_000, lastAttemptAt: NOW })).toBe("learning");
    expect(masteryOf({ stage: 4, dueAt: NOW + 14 * DAY, lastAttemptAt: NOW })).toBe("learning");
    expect(masteryOf({ stage: 5, dueAt: NOW + MASTERED_INTERVAL_MS, lastAttemptAt: NOW })).toBe(
      "mastered"
    );
  });

  it("calls a decision learned from stage 1", () => {
    expect([null, { stage: 0 }, { stage: 1 }, { stage: 6 }].map(isLearned)).toStrictEqual([
      false,
      false,
      true,
      true
    ]);
  });
});

describe("perfect lines", () => {
  it("lists each line's practised positions once, across chapters and transpositions", () => {
    const white = [
      chapterOf([
        ["e2e4", "e7e5", "g1f3"],
        ["e2e4", "c7c5", "b1c3"]
      ]),
      // The same first line again in another chapter: one line.
      chapterOf([["e2e4", "e7e5", "g1f3"]]),
      chapterOf([["d2d4"]], { kind: "reference" }),
      chapterOf([["c2c4"]], { enabled: false })
    ];
    const lines = practiceLines(white, "white");
    expect(lines).toStrictEqual(
      [
        [START_FEN, lineFens(START_FEN, ["e2e4", "e7e5"]).at(-1)!],
        [START_FEN, lineFens(START_FEN, ["e2e4", "c7c5"]).at(-1)!]
      ].map((fens) => fens.map(positionKey).sort())
    );
    const learned = new Set([positionKey(START_FEN), keyAfter(["e2e4", "e7e5"])]);
    expect(perfectLineCount(lines, (key) => learned.has(key))).toBe(1);
    learned.delete(positionKey(START_FEN));
    expect(perfectLineCount(lines, (key) => learned.has(key))).toBe(0);
  });

  it("leaves a paused decision out of its lines", () => {
    const lines = practiceLines(
      [chapterOf([["e2e4", "e7e5", "g1f3"]])],
      "white",
      new Set([positionKey(START_FEN)])
    );
    expect(lines).toStrictEqual([[keyAfter(["e2e4", "e7e5"])]]);
  });
});

describe("openings", () => {
  const book = parseOpeningBook(openingBookText());

  it("names a line by its deepest named position, the start included", () => {
    expect(
      deepestOpening(book, lineFens(START_FEN, ["e2e4", "c7c6", "d2d4", "d7d5", "e4e5"]))
    ).toStrictEqual({ name: "Caro-Kann Defense: Advance Variation", eco: "B12" });
    // A move out of the book keeps the last name reached.
    expect(
      deepestOpening(book, lineFens(START_FEN, ["e2e4", "c7c6", "h2h4", "a7a6", "a2a3"]))
    ).toMatchObject({ eco: expect.stringMatching(/^B1/) });
    expect(deepestOpening(book, [START_FEN])).toBeNull();
  });

  it("follows a chapter's mainline (first children) and stops at an illegal move", () => {
    const chapter = chapterOf([
      ["d2d4", "d7d5"],
      ["e2e4", "e7e5"]
    ]);
    expect(mainlineFens(chapter.tree, START_FEN)).toStrictEqual(
      lineFens(START_FEN, ["d2d4", "d7d5"])
    );
    expect(lineFens(START_FEN, ["e2e4", "e2e4"])).toHaveLength(2);
  });
});
