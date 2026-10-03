import { describe, expect, it } from "vitest";
import { parseAnnotationComment, serializeAnnotationComment } from "./annotations";

describe("PGN annotation comments", () => {
  it("parses arrows and square highlights", () => {
    const parsed = parseAnnotationComment("Idea [%cal Gg1f3,Rd1h5] [%csl Ye4,Bh7]");
    expect(parsed.clock).toBeNull();
    expect(parsed.text).toBe("Idea");
    expect(parsed.arrows).toEqual([
      { color: "green", orig: "g1", dest: "f3" },
      { color: "red", orig: "d1", dest: "h5" }
    ]);
    expect(parsed.highlights).toEqual([
      { color: "yellow", square: "e4" },
      { color: "blue", square: "h7" }
    ]);
  });

  it("parses clock tags", () => {
    const parsed = parseAnnotationComment("[%clk 1:23:45]");
    expect(parsed.clock).toBe("1:23:45");
    expect(parsed.text).toBeNull();
  });

  it("parses clock without space after clk token", () => {
    expect(parseAnnotationComment("[%clk1:00:00]").clock).toBe("1:00:00");
  });

  it("drops Lichess-style suffix after clock semicolon", () => {
    expect(parseAnnotationComment("[%clk 0:09:59.2;18]").clock).toBe("0:09:59.2");
  });

  it("serializes annotations to common PGN tags", () => {
    expect(
      serializeAnnotationComment(
        "Idea",
        [{ color: "green", orig: "g1", dest: "f3" }],
        [{ color: "yellow", square: "e4" }]
      )
    ).toBe("Idea [%cal Gg1f3] [%csl Ye4]");
  });

  it("keeps a closing brace in the text from ending the comment", () => {
    expect(serializeAnnotationComment("Plan {a} then b", [], [])).toBe("Plan {a) then b");
  });

  it("serializes clock tags", () => {
    expect(serializeAnnotationComment(null, [], [], "0:05:00")).toBe("[%clk 0:05:00]");
  });
});
