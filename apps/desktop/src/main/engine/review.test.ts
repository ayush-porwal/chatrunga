import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EngineConfig, MaiaRating, ReviewMoveInputItem } from "@chaturanga/shared/types/engine";
import { fenAfterUci } from "@chaturanga/shared/chess/position";
import { analysePositionsWithEngine, reviewGameWithEngine } from "./review";

const FAKE = join(__dirname, "__fixtures__", "fake-uci.mjs");
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function fakeEngine(id: string, mode: "sf" | "maia", extra: Partial<EngineConfig> = {}): EngineConfig {
  return {
    id,
    name: id,
    executablePath: process.execPath,
    workingDirectory: null,
    weightsPath: null,
    imagePath: null,
    args: [FAKE, mode],
    protocol: "uci",
    runtime: "custom-uci",
    isAvailable: true,
    isDefault: false,
    createdAt: 0,
    updatedAt: 0,
    ...extra
  };
}

function foolsMate(): ReviewMoveInputItem[] {
  const ucis = ["f2f3", "e7e5", "g2g4", "d8h4"];
  const sans = ["f3", "e5", "g4", "Qh4#"];
  let fen = START;
  return ucis.map((uci, index) => {
    const fenAfter = fenAfterUci(fen, uci)!;
    const item = { nodeId: `n${index}`, ply: index + 1, san: sans[index], uci, fenBefore: fen, fenAfter };
    fen = fenAfter;
    return item;
  });
}

describe("reviewGameWithEngine (scripted UCI engines)", () => {
  it("degrades when one Maia cannot start, records engine data and synthesizes the terminal eval", async () => {
    const maia1100 = { ...fakeEngine("maia-1100", "maia"), maiaRating: 1100 as MaiaRating };
    const broken = {
      ...fakeEngine("maia-1900", "maia"),
      executablePath: "/nonexistent/lc0",
      maiaRating: 1900 as MaiaRating
    };
    const phases: string[] = [];
    const review = await reviewGameWithEngine(
      fakeEngine("sf", "sf"),
      { reviewId: "t", engineId: "sf", rootFen: START, moves: foolsMate(), multipv: 3, moveTimeMs: 50 },
      { onPhaseProgress: (p) => phases.push(`${p.moveIndex}:${p.phase}`) },
      [maia1100, broken],
      { threads: 2, hashMb: 64, playerRating: 1200 }
    );

    expect(review.schemaVersion).toBe(2);
    expect(review.engineName).toBe("Fake sf");
    expect(review.engineSettings).toEqual({ multipv: 3, moveTimeMs: 50, depth: null, threads: 2, hashMb: 64 });
    expect(review.maiaEngines).toEqual([{ rating: 1100, engineId: "maia-1100", name: "maia-1100" }]);
    // One progress event per phase per move; no "after" phase for the mating move.
    expect(phases).toEqual(["0:before", "0:after", "1:before", "1:after", "2:before", "2:after", "3:before"]);

    const first = review.moves[0];
    expect(first.topLines).toHaveLength(3);
    expect(first.topLines[0].wdl).toEqual({ win: 300, draw: 500, loss: 200 });
    expect(first.replyLines).toHaveLength(3);
    expect(first.wdlBefore).toEqual({ win: 300, draw: 500, loss: 200 });
    expect(first.humanPredictions).toHaveLength(1);
    expect(first.humanPredictions![0].rating).toBe(1100);
    expect(first.humanPredictions![0].topMoves[0].prob).toBeCloseTo(0.2375, 4);
    // g2g4 is the fake engine's 2nd line → same-search rank and score.
    const third = review.moves[2];
    expect(third.playedRank).toBe(2);
    expect(third.playedLineScore).toEqual({ type: "cp", value: 20 });
    expect(third.evalLoss).toBe(20);

    const last = review.moves[3];
    expect(last.terminal).toBe("checkmate");
    expect(last.evalAfter).toEqual({ type: "mate", value: 0 });
    expect(last.replyLines).toEqual([]);
    expect(last.wdlAfter).toEqual({ win: 0, draw: 0, loss: 1000 });
    expect(last.evalLoss).toBe(0);
    expect(last.classification).toBe("best");
  }, 30_000);
});

describe("review reuse", () => {
  it("a second review with the same settings reuses every finished move; new settings review again", async () => {
    const run = async (moveTimeMs: number) => {
      const phases: string[] = [];
      const review = await reviewGameWithEngine(
        fakeEngine("sf-cache", "sf"),
        { reviewId: "c", engineId: "sf-cache", rootFen: START, moves: foolsMate(), multipv: 2, moveTimeMs },
        { onPhaseProgress: (p) => phases.push(`${p.moveIndex}:${p.phase}`) }
      );
      return { review, phases };
    };
    const first = await run(77);
    expect(first.phases.length).toBeGreaterThan(0);

    const again = await run(77);
    expect(again.phases).toEqual([]);
    expect(again.review.moves.map((move) => [move.nodeId, move.classification])).toEqual(
      first.review.moves.map((move) => [move.nodeId, move.classification])
    );

    const otherBudget = await run(78);
    expect(otherBudget.phases.length).toBe(first.phases.length);
  });

  // A shell wrapper stands in for the engine binary, so it can be replaced at the same path.
  it.skipIf(process.platform === "win32")("an engine binary replaced at the same path reviews again", async () => {
    const executablePath = join(mkdtempSync(join(tmpdir(), "review-cache-")), "engine");
    const install = (version: string) =>
      writeFileSync(executablePath, `#!/bin/sh\n# ${version}\nexec "${process.execPath}" "${FAKE}" sf\n`, { mode: 0o755 });
    install("v1");
    const run = async () => {
      const phases: string[] = [];
      await reviewGameWithEngine(
        fakeEngine("sf-binary", "sf", { executablePath, args: [] }),
        { reviewId: "b", engineId: "sf-binary", rootFen: START, moves: foolsMate(), multipv: 2, moveTimeMs: 50 },
        { onPhaseProgress: (p) => phases.push(`${p.moveIndex}:${p.phase}`) }
      );
      return phases;
    };
    const first = await run();
    expect(first.length).toBeGreaterThan(0);
    expect(await run()).toEqual([]);

    install("v2 (updated)");
    expect((await run()).length).toBe(first.length);
  });

  it.skipIf(process.platform === "win32")("a binary replaced while the engine starts is not cached", async () => {
    const executablePath = join(mkdtempSync(join(tmpdir(), "review-cache-")), "engine");
    // Every start replaces the file it was launched from, as an update landing mid-startup would.
    writeFileSync(executablePath, `#!/bin/sh\necho "# replaced" >> "$0"\nexec "${process.execPath}" "${FAKE}" sf\n`, {
      mode: 0o755
    });
    const run = async () => {
      const phases: string[] = [];
      await reviewGameWithEngine(
        fakeEngine("sf-racing", "sf", { executablePath, args: [] }),
        { reviewId: "r", engineId: "sf-racing", rootFen: START, moves: foolsMate(), multipv: 2, moveTimeMs: 50 },
        { onPhaseProgress: (p) => phases.push(`${p.moveIndex}:${p.phase}`) }
      );
      return phases;
    };
    const first = await run();
    expect((await run()).length).toBe(first.length);
  });
});

describe("analysePositionsWithEngine", () => {
  it("searches each position with its own line count and skips a finished one", async () => {
    const mated = foolsMate()[3]!.fenAfter;
    const result = await analysePositionsWithEngine(
      fakeEngine("sf", "sf"),
      { positions: [{ fen: START, multipv: 3 }, { fen: mated, multipv: 2 }, { fen: START, multipv: 1 }], moveTimeMs: 50 },
      { threads: 1, hashMb: 16 }
    );
    expect(result.engineName).toBe("Fake sf");
    expect(result.lines.map((lines) => lines.length)).toEqual([3, 0, 1]);
    expect(result.lines[0]![0]).toMatchObject({ multipv: 1, pv: ["d1h5"], scoreWhite: { type: "cp", value: 40 } });
  });

  it("refuses partial lines once cancelled", async () => {
    let cancelled = false;
    setTimeout(() => {
      cancelled = true;
    }, 100);
    await expect(
      analysePositionsWithEngine(
        fakeEngine("slow", "sf", { args: [FAKE, "sf", "slow-start"] }),
        { positions: [{ fen: START, multipv: 1 }], moveTimeMs: 50 },
        { shouldCancel: () => cancelled }
      )
    ).rejects.toThrow("Review cancelled");
  });
});

describe("review cancellation", () => {
  it("is honoured while the engine is still starting up", async () => {
    const started = Date.now();
    let cancelled = false;
    setTimeout(() => {
      cancelled = true;
    }, 100);
    await expect(
      reviewGameWithEngine(
        fakeEngine("slow", "sf", { args: [FAKE, "sf", "slow-start"] }),
        { reviewId: "r", engineId: "slow", rootFen: START, moves: foolsMate() },
        { shouldCancel: () => cancelled }
      )
    ).rejects.toThrow("Review cancelled");
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
