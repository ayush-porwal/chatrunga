import { describe, expect, it } from "vitest";
import { parseAnnotationComment, serializeAnnotationComment } from "./annotations";

describe("PGN annotation comments", () => {
  it("parses arrows and square highlights", () => {
    const parsed = parseAnnotationComment("Idea [%cal Gg1f3,Rd1h5] [%csl Ye4,Bh7]");
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

  it("serializes annotations to common PGN tags", () => {
    expect(
      serializeAnnotationComment(
        "Idea",
        [{ color: "green", orig: "g1", dest: "f3" }],
        [{ color: "yellow", square: "e4" }]
      )
    ).toBe("Idea [%cal Gg1f3] [%csl Ye4]");
  });
});
