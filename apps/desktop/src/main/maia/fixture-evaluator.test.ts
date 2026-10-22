import { describe, expect, it } from "vitest";
import { validMaia3Output } from "@chaturanga/shared/engine/maia3-host";
import {
  FIXTURE_MAIA3_VALUE,
  FixtureMaia3Evaluator,
  fixtureMaia3Output
} from "./fixture-evaluator";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
/** White can castle either way and promote on b8 (with or without taking a8). */
const CASTLE_AND_PROMOTE = "r3k3/1P6/8/8/8/8/8/R3K2R w KQq - 0 1";
const MATED = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3";

describe("fixtureMaia3Output", () => {
  it("is a valid Maia 3 output over every legal move, the same every time", () => {
    const output = fixtureMaia3Output({ fen: START, eloSelf: 1500, eloOppo: 1500 });
    expect(Object.keys(output.policy)).toHaveLength(20);
    expect(output.value).toBe(FIXTURE_MAIA3_VALUE);
    expect(validMaia3Output(START, output)).not.toBeNull();
    expect(fixtureMaia3Output({ fen: START, eloSelf: 1500, eloOppo: 1500 })).toStrictEqual(output);
  });

  it("names castling and promotions as Maia does (standard UCI, every piece)", () => {
    const output = fixtureMaia3Output({ fen: CASTLE_AND_PROMOTE, eloSelf: 1100, eloOppo: 1100 });
    const moves = Object.keys(output.policy);
    expect(moves).toStrictEqual(
      expect.arrayContaining(["e1g1", "e1c1", "b7b8q", "b7b8n", "b7a8r"])
    );
    expect(moves).not.toContain("e1h1");
    expect(validMaia3Output(CASTLE_AND_PROMOTE, output)).not.toBeNull();
  });

  it("concentrates on its first moves more at higher ratings", () => {
    const topAt = (eloSelf: number) =>
      Math.max(...Object.values(fixtureMaia3Output({ fen: START, eloSelf, eloOppo: 1500 }).policy));
    expect(topAt(2600)).toBeGreaterThan(topAt(1500));
    expect(topAt(1500)).toBeGreaterThan(topAt(600));
  });

  it("has no moves in a finished position", () => {
    expect(fixtureMaia3Output({ fen: MATED, eloSelf: 1500, eloOppo: 1500 }).policy).toStrictEqual(
      {}
    );
  });
});

describe("FixtureMaia3Evaluator", () => {
  it("answers every query in order, and refuses an aborted request", async () => {
    const evaluator = new FixtureMaia3Evaluator();
    expect(evaluator.isInstalled()).toBe(true);
    const queries = [
      { fen: START, eloSelf: 1500, eloOppo: 1500 },
      { fen: CASTLE_AND_PROMOTE, eloSelf: 1500, eloOppo: 1500 }
    ];
    await expect(evaluator.evaluate(queries)).resolves.toStrictEqual(
      queries.map(fixtureMaia3Output)
    );
    await expect(evaluator.evaluate(queries, { signal: AbortSignal.abort() })).rejects.toThrow(
      /aborted/
    );
    await expect(evaluator.evaluate([{ ...queries[0], fen: "not a fen" }])).rejects.toThrow(
      /can't read the position/
    );
  });
});
