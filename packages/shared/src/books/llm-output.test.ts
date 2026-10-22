import { describe, expect, it } from "vitest";
import {
  BookOutputError,
  extractJsonObject,
  parseBookOutline,
  parseBookRepair,
  parsePageLines,
  parseStoredPageLines
} from "./llm-output";

describe("extractJsonObject", () => {
  it("reads the object out of a fenced or chatty answer", () => {
    expect(extractJsonObject('Here you go:\n```json\n{"moves": null}\n```')).toStrictEqual({
      moves: null
    });
  });

  it.each(["no json here", "{ broken", "} {"])("refuses %j", (text) => {
    expect(() => extractJsonObject(text)).toThrow(BookOutputError);
  });
});

describe("parsePageLines", () => {
  it("keeps well-formed lines and notes, trimmed, and drops malformed ones", () => {
    const parsed = parsePageLines({
      game: { white: " Alpha ", black: "Beta", event: "Test Open", year: 2001 },
      lines: [
        {
          label: "a1",
          kind: "main",
          role: "own-recommended",
          moves: " 1. e4 c5 ",
          notes: [
            { after: "1. e4", text: " Best by test. ", symbols: "!" },
            { after: "1... c5", text: "", symbols: null },
            { text: "no anchor" },
            "junk"
          ]
        },
        { kind: "variation", role: "opponent", moves: "" },
        { kind: "variation", moves: 42 },
        null
      ]
    });
    expect(parsed).toStrictEqual({
      game: { white: "Alpha", black: "Beta", event: "Test Open", year: "2001" },
      lines: [
        {
          label: "a1",
          kind: "main",
          role: "own-recommended",
          moves: "1. e4 c5",
          notes: [{ after: "1. e4", text: "Best by test.", symbols: "!" }]
        }
      ]
    });
  });

  it("maps older role names and defaults unknown ones by the line's kind", () => {
    const roles = parsePageLines({
      game: null,
      lines: [
        { kind: "main", role: "recommended", moves: "1. e4" },
        { kind: "variation", role: "alternative", moves: "1. d4" },
        { kind: "variation", role: "black-option", moves: "1. e4 e5" },
        { kind: "main", role: "whatever", moves: "1. c4" },
        { kind: "sideline", moves: "1. Nf3" }
      ]
    }).lines.map((line) => [line.kind, line.role]);
    expect(roles).toStrictEqual([
      ["main", "own-recommended"],
      ["variation", "own-alternative"],
      ["variation", "opponent"],
      ["main", "own-recommended"],
      ["variation", "opponent"]
    ]);
  });

  it("ignores a repair history in the model's answer, and keeps a stored line's", () => {
    const page = { lines: [{ moves: "1. e4", repairedFrom: "1. e5", repairAttempts: 2 }] };
    const [answered] = parsePageLines(page).lines;
    expect(answered).not.toHaveProperty("repairedFrom");
    expect(answered).not.toHaveProperty("repairAttempts");
    const [stored] = parseStoredPageLines(page).lines;
    expect(stored).toMatchObject({ repairedFrom: "1. e5", repairAttempts: 2 });
  });

  it.each([null, [], { lines: "none" }, { game: null }])("refuses %j", (value) => {
    expect(() => parsePageLines(value)).toThrow(BookOutputError);
  });

  it("drops a game without both players", () => {
    expect(parsePageLines({ game: { white: "Alpha" }, lines: [] }).game).toBeNull();
  });
});

describe("parseBookOutline", () => {
  it("reads the title, side, offset and chapters (page numbers as text too)", () => {
    expect(
      parseBookOutline({
        title: "A Test Repertoire",
        author: "",
        color: "Black",
        printedPageOffset: "2",
        chapters: [
          { number: 1, title: "First", firstPage: "5", lastPage: 20 },
          { title: "Second", firstPage: 21, lastPage: 3 },
          { title: "No page" },
          { title: "", firstPage: 9 }
        ]
      })
    ).toStrictEqual({
      title: "A Test Repertoire",
      author: null,
      color: "black",
      printedPageOffset: 2,
      chapters: [
        { number: 1, title: "First", firstPage: 5, lastPage: 20 },
        { number: null, title: "Second", firstPage: 21, lastPage: null }
      ]
    });
  });

  it.each([
    [{ color: "white" }, "no title"],
    [{ title: "X", color: "both" }, "which side"],
    ["text", "isn't an object"]
  ])("refuses %j", (value, message) => {
    expect(() => parseBookOutline(value)).toThrow(message);
  });

  it("defaults a missing offset to zero and missing chapters to none", () => {
    expect(parseBookOutline({ title: "X", color: "white" })).toMatchObject({
      printedPageOffset: 0,
      chapters: []
    });
  });
});

describe("parseBookRepair", () => {
  it("reads repaired moves, or null when the book can't be read", () => {
    expect(parseBookRepair({ moves: "1. e4" })).toStrictEqual({ moves: "1. e4" });
    expect(parseBookRepair({ moves: null })).toStrictEqual({ moves: null });
  });

  it("refuses an answer without moves", () => {
    expect(() => parseBookRepair({ line: "1. e4" })).toThrow(BookOutputError);
  });
});
