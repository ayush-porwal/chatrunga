import { describe, expect, it } from "vitest";
import { parsePieceDrawings, pieceSetCss } from "./generated-piece-themes";

const drawing = (name: string) => `<svg viewBox="0 0 10 10"><path id="${name}"/></svg>`;
const codes = ["wP", "wN", "wB", "wR", "wQ", "wK", "bP", "bN", "bB", "bR", "bQ", "bK"];

function payload(sets: string[]): string {
  const drawings = sets.flatMap((set) => codes.map((code) => drawing(`${set}-${code}`)));
  const uniform = sets.flatMap(() => codes.map(() => "1 2 30 30"));
  return [sets.join(" "), ...drawings, ...uniform].join("\0");
}

describe("parsePieceDrawings", () => {
  it("reads each named set's drawings and swaps in its uniform viewBoxes", () => {
    const sets = parsePieceDrawings(payload(["cburnett", "merida"]));
    const merida = sets.get("merida");
    expect(merida?.ladder[5]).toBe(drawing("merida-wK"));
    expect(merida?.uniform[5]).toBe('<svg viewBox="1 2 30 30"><path id="merida-wK"/></svg>');
  });

  it("refuses an unknown set or a short payload", () => {
    expect(() => parsePieceDrawings(payload(["neon"]))).toThrow(/malformed/);
    const short = payload(["merida"]).split("\0").slice(0, -1).join("\0");
    expect(() => parsePieceDrawings(short)).toThrow(/malformed/);
  });
});

describe("pieceSetCss", () => {
  it("scopes the ranked drawings to the set and the uniform ones to its uniform class", () => {
    const css = pieceSetCss("merida", parsePieceDrawings(payload(["merida"])).get("merida")!);
    expect(css).toContain(".cg-wrap.piece-set-merida piece.king.white{background-image:url(");
    expect(css).toContain(".cg-wrap.piece-set-merida.piece-sizes-uniform piece.king.white{");
    expect(css).toContain("viewBox=%271%202%2030%2030%27");
  });
});
