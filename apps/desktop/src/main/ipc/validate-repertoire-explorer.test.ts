import { describe, expect, it } from "vitest";
import { START_FEN } from "@chaturanga/shared/chess/position";
import {
  parseExplorerMaiaInput,
  parseExplorerPositionInput,
  parseRepertoireIds
} from "./validate-repertoire-explorer";

describe("repertoire explorer IPC inputs", () => {
  it("keeps the known fields of a position, and refuses a bad FEN or id", () => {
    expect(
      parseExplorerPositionInput({ repertoireId: "r1", fen: START_FEN, extra: true })
    ).toStrictEqual({ repertoireId: "r1", fen: START_FEN });
    expect(() => parseExplorerPositionInput({ repertoireId: "r1", fen: "nope" })).toThrow(/FEN/);
    expect(() => parseExplorerPositionInput({ repertoireId: "", fen: START_FEN })).toThrow(
      /repertoireId/
    );
  });

  it("takes Maia's rating on its range and a known time control, or null for the defaults", () => {
    const position = { repertoireId: "r1", fen: START_FEN };
    expect(parseExplorerMaiaInput({ ...position, rating: null, mode: null })).toStrictEqual({
      ...position,
      rating: null,
      mode: null
    });
    expect(parseExplorerMaiaInput({ ...position, rating: 1700, mode: "blitz" })).toMatchObject({
      rating: 1700,
      mode: "blitz"
    });
    expect(() => parseExplorerMaiaInput({ ...position, rating: 3000, mode: null })).toThrow(
      /rating/
    );
    expect(() => parseExplorerMaiaInput({ ...position, rating: null, mode: "hyper" })).toThrow(
      /mode/
    );
  });

  it("names each repertoire once", () => {
    expect(parseRepertoireIds(["a", "b", "a"])).toStrictEqual(["a", "b"]);
    expect(() => parseRepertoireIds("a")).toThrow(/repertoireIds/);
  });
});
