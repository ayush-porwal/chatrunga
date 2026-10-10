import { afterEach, describe, expect, it, vi } from "vitest";
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
    // A drawing whose root viewBox can't be swapped would silently stay ranked.
    const unboxed = payload(["merida"]).replace('<svg viewBox="0 0 10 10">', "<svg>");
    expect(() => parsePieceDrawings(unboxed)).toThrow(/malformed/);
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

describe("ensurePieceSet", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("retries a set that failed to load, and adds its CSS once it does", async () => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sheets: { textContent: string; dataset: Record<string, string> }[] = [];
    vi.stubGlobal("document", {
      createElement: () => ({ textContent: "", dataset: {} }),
      head: { append: (sheet: (typeof sheets)[number]) => sheets.push(sheet) }
    });
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(new Response(payload(["merida"])));
    vi.stubGlobal("fetch", fetch);
    const { ensurePieceSet, PIECE_SET_RETRY_MS } = await import("./generated-piece-themes");

    await ensurePieceSet("merida");
    expect(sheets).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(PIECE_SET_RETRY_MS[0]!);
    await vi.waitFor(() => expect(sheets).toHaveLength(1));
    expect(sheets[0]?.dataset.pieceSet).toBe("merida");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
