import { describe, expect, it } from "vitest";
import {
  asAbsolutePath,
  asFen,
  asId,
  asLichessId,
  asLichessUci,
  asUciMoves,
  parseDefaultFileName,
  parseDialogFilters,
  parseEngineInput,
  parseEnginePatch,
  parseLichessAiChallengeInput,
  parseLichessChallengeInput,
  parseLichessDisconnectInput,
  parseLichessSeekInput,
  parsePgnText,
  parseProbeEvalInput,
  parsePuzzleSampleInput,
  parseReviewGameInput,
  parseSaveGameInput,
  parseSettingKey,
  parseStartAnalysisInput,
  parseStartGameInput
} from "./validate";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

describe("primitive validators", () => {
  it("accepts ids and rejects empty / multi-line ones", () => {
    expect(asId(" abc ")).toBe("abc");
    expect(() => asId("")).toThrow(/Invalid id/);
    expect(() => asId("a\nb")).toThrow();
    expect(() => asId(42)).toThrow();
    expect(() => asId("x".repeat(201))).toThrow(/too long/);
  });

  it("requires absolute paths", () => {
    expect(asAbsolutePath(" /usr/local/bin/stockfish ", "path")).toBe("/usr/local/bin/stockfish");
    expect(() => asAbsolutePath("stockfish", "path")).toThrow(/absolute/);
    expect(() => asAbsolutePath("/bin/sh\0", "path")).toThrow();
    expect(() => asAbsolutePath("", "path")).toThrow();
  });

  it("accepts legal FENs only, and never newlines (UCI command injection)", () => {
    expect(asFen(START)).toBe(START);
    expect(() => asFen(`${START}\nquit`)).toThrow(/control/);
    expect(() => asFen("8/8/8/8/8/8/8/8 w - - 0 1")).toThrow(/legal/);
    expect(() => asFen("hello")).toThrow();
  });

  it("accepts UCI moves only", () => {
    expect(asUciMoves(["e2e4", "e7e8q", "e1h1"])).toEqual(["e2e4", "e7e8q", "e1h1"]);
    expect(() => asUciMoves(["e4"])).toThrow(/UCI move/);
    expect(() => asUciMoves(["e2e4 quit"])).toThrow();
    expect(() => asUciMoves("e2e4")).toThrow();
  });
});

describe("engine inputs", () => {
  it("normalizes a new engine", () => {
    expect(
      parseEngineInput({
        name: "  ",
        executablePath: "/opt/lc0",
        workingDirectory: "",
        weightsPath: " /nets/maia-1500.pb.gz ",
        imagePath: "https://example.com/lc0.png",
        args: ["--threads=2"],
        isHumanPrediction: true,
        maiaRating: 1500,
        unknown: "dropped"
      })
    ).toEqual({
      name: "UCI Engine",
      executablePath: "/opt/lc0",
      workingDirectory: null,
      weightsPath: "/nets/maia-1500.pb.gz",
      imagePath: "https://example.com/lc0.png",
      args: ["--threads=2"],
      isHumanPrediction: true,
      maiaRating: 1500
    });
  });

  it("rejects unusable engines", () => {
    expect(() => parseEngineInput({ name: "x" })).toThrow(/executable path is required/);
    expect(() => parseEngineInput({ executablePath: "relative/sf" })).toThrow(/absolute/);
    expect(() => parseEngineInput({ executablePath: "/sf", args: "--x" })).toThrow(/args/);
    expect(() => parseEngineInput({ executablePath: "/sf", maiaRating: 1600 })).toThrow(/Maia/);
    expect(() => parseEngineInput(null)).toThrow(/object/);
  });

  it("keeps only the fields a patch sets", () => {
    expect(parseEnginePatch({ isDefault: true })).toEqual({ isDefault: true });
    expect(parseEnginePatch({ weightsPath: null, imagePath: "" })).toEqual({ weightsPath: null, imagePath: null });
    expect(() => parseEnginePatch({ isDefault: "yes" })).toThrow(/boolean/);
  });
});

describe("engine session inputs", () => {
  it("parses engine games", () => {
    expect(
      parseStartGameInput({ engineId: "sf", side: "black", fen: START, moves: ["e2e4"], clock: { wtime: 1, btime: 2, winc: 0, binc: 0 } })
    ).toEqual({
      engineId: "sf",
      side: "black",
      fen: START,
      moves: ["e2e4"],
      moveTimeMs: null,
      depth: null,
      clock: { wtime: 1, btime: 2, winc: 0, binc: 0 }
    });
    expect(() => parseStartGameInput({ engineId: "sf", side: "white", fen: START, moves: [], depth: -1 })).toThrow(/negative/);
    expect(() => parseStartGameInput({ engineId: "sf", side: "white", fen: START, clock: { wtime: "1" } })).toThrow(/clock/);
    expect(() => parseStartGameInput({ engineId: "sf", side: "white", fen: START, depth: 2.5 })).toThrow(/whole/);
    expect(() => parseStartGameInput({ engineId: "sf", side: "white", fen: START, depth: 10_000 })).toThrow(/at most/);
    expect(() => parseStartGameInput({ engineId: "sf", side: "purple", fen: START })).toThrow(/side/);
  });

  it("parses analysis and probe requests", () => {
    expect(parseStartAnalysisInput({ engineId: "sf", fen: START, moves: [], multipv: 3 })).toMatchObject({ multipv: 3 });
    expect(parseProbeEvalInput({ engineId: "sf", fen: START, moves: [] }).movetimeMs).toBe(400);
    expect(parseProbeEvalInput({ engineId: "sf", fen: START, moves: [], movetimeMs: 1e9 }).movetimeMs).toBe(60_000);
  });

  it("parses a review", () => {
    const review = parseReviewGameInput({
      reviewId: "r1",
      engineId: "sf",
      rootFen: START,
      moves: [{ nodeId: "n1", ply: 1, san: "e4", uci: "e2e4", fenBefore: START, fenAfter: AFTER_E4, clockAfter: null }],
      predictionEngineIds: ["maia-1", ""],
      multipv: 3
    });
    expect(review.predictionEngineIds).toEqual(["maia-1"]);
    expect(review.moves[0]).toMatchObject({ uci: "e2e4", clockAfter: null });
    expect(review.nodes).toBeNull();
    expect(parseReviewGameInput({ engineId: "sf", rootFen: START, moves: [] }).reviewId).toMatch(/^review-/);
    expect(() => parseReviewGameInput({ engineId: "sf", rootFen: START, moves: [{ uci: "bad" }] })).toThrow();
    expect(() => parseReviewGameInput({ engineId: "sf", rootFen: START })).toThrow(/moves/);
  });
});

describe("library inputs", () => {
  const game = { source: "pgn-import", headers: {}, rootFen: START, currentFen: START, pgn: "*", moveTree: [] };

  it("shape-checks saved games", () => {
    expect(parseSaveGameInput({ ...game, id: null })).toMatchObject({ id: null, source: "pgn-import" });
    expect(() => parseSaveGameInput({ ...game, source: "hosted" })).toThrow(/source/);
    expect(parseSaveGameInput({ ...game, source: "lichess" })).toMatchObject({ source: "lichess" });
    expect(() => parseSaveGameInput({ ...game, moveTree: {} })).toThrow(/moveTree/);
    expect(() => parseSaveGameInput({ ...game, pgn: 1 })).toThrow(/PGN/);
    expect(() => parseSaveGameInput({ ...game, review: "x" })).toThrow(/review/);
  });

  it("parses PGN imports and settings keys", () => {
    expect(parsePgnText({ pgn: "1. e4 *" })).toBe("1. e4 *");
    expect(() => parsePgnText({})).toThrow();
    expect(parseSettingKey("reviewMultiPv")).toBe("reviewMultiPv");
    expect(() => parseSettingKey("__proto__")).toThrow(/unknown key/);
  });

  it("parses dialog inputs", () => {
    expect(parseDialogFilters(undefined)).toEqual([]);
    expect(parseDialogFilters([{ name: "Images", extensions: ["png"] }])).toEqual([{ name: "Images", extensions: ["png"] }]);
    expect(() => parseDialogFilters([{ name: "x" }])).toThrow();
    expect(parseDefaultFileName("../../etc/game.pgn")).toBe(".._.._etc_game.pgn");
    expect(parseDefaultFileName("  ")).toBe("chaturanga-game.pgn");
  });

  it("parses puzzle filters", () => {
    const parsed = parsePuzzleSampleInput({
      databaseId: "db",
      lichess: { ratingMin: 800, ratingMax: 1600, popularityMin: 0, lengths: [], themes: ["fork"], openings: [], side: "sideways" },
      position: { difficultyMin: 0, difficultyMax: 5, tags: [] }
    });
    expect(parsed.lichess?.side).toBe("any");
    expect(parsed.position?.difficultyMax).toBe(5);
    expect(() => parsePuzzleSampleInput({ databaseId: "db", lichess: { ratingMin: "low" } })).toThrow();
  });
});

describe("Lichess inputs", () => {
  it("accepts Lichess ids and UCI moves only (they become URL path segments)", () => {
    expect(asLichessId("abcd1234")).toBe("abcd1234");
    expect(asLichessId("abcd1234WXYZ")).toBe("abcd1234WXYZ");
    expect(() => asLichessId("abc")).toThrow(/Lichess id/);
    expect(() => asLichessId("abcd1234/../account")).toThrow();
    expect(() => asLichessId("abcd 234")).toThrow();
    expect(asLichessUci("e7e8q")).toBe("e7e8q");
    expect(() => asLichessUci("e4")).toThrow(/UCI/);
    expect(() => asLichessUci("e2e4/")).toThrow();
  });

  it("parses seeks", () => {
    expect(parseLichessSeekInput({ minutes: 10, incrementSec: 5, rated: true, ratingRange: [1400, 1800] })).toEqual({
      minutes: 10,
      incrementSec: 5,
      rated: true,
      ratingRange: [1400, 1800]
    });
    expect(parseLichessSeekInput({ minutes: 1.5, incrementSec: 0, rated: false, ratingRange: null }).ratingRange).toBeNull();
    expect(() => parseLichessSeekInput({ minutes: 200, incrementSec: 0, rated: true })).toThrow(/minutes/);
    expect(() => parseLichessSeekInput({ minutes: 10, incrementSec: 2.5, rated: true })).toThrow(/whole/);
    expect(() => parseLichessSeekInput({ minutes: 10, incrementSec: 0, rated: "yes" })).toThrow(/rated/);
    expect(() =>
      parseLichessSeekInput({ minutes: 10, incrementSec: 0, rated: true, ratingRange: [1800, 1400] })
    ).toThrow(/rating range/);
    expect(() => parseLichessSeekInput({ minutes: 10, incrementSec: 0, rated: true, ratingRange: [1] })).toThrow();
  });

  it("parses challenges", () => {
    expect(
      parseLichessChallengeInput({ username: " Georges_1 ", minutes: 15, incrementSec: 10, rated: false, color: "black" })
    ).toEqual({ username: "Georges_1", minutes: 15, incrementSec: 10, rated: false, color: "black" });
    const valid = { username: "Salma", minutes: 10, incrementSec: 0, rated: true, color: "random" };
    expect(() => parseLichessChallengeInput({ ...valid, username: "a/b" })).toThrow(/username/);
    expect(() => parseLichessChallengeInput({ ...valid, username: "x" })).toThrow(/username/);
    expect(() => parseLichessChallengeInput({ ...valid, color: "green" })).toThrow(/color/);
    expect(() => parseLichessChallengeInput({ ...valid, incrementSec: 90 })).toThrow(/increment/);
    expect(() => parseLichessChallengeInput({ ...valid, minutes: 10.01 })).toThrow(/whole seconds/);
  });

  it("parses AI challenges and disconnect options", () => {
    expect(parseLichessAiChallengeInput({ level: 3, minutes: 10, incrementSec: 0, color: "white" })).toEqual({
      level: 3,
      minutes: 10,
      incrementSec: 0,
      color: "white"
    });
    expect(() => parseLichessAiChallengeInput({ level: 9, minutes: 10, incrementSec: 0, color: "white" })).toThrow(/level/);
    expect(parseLichessDisconnectInput({ removeGames: true })).toEqual({ removeGames: true });
    expect(() => parseLichessDisconnectInput({})).toThrow(/removeGames/);
  });
});

describe("parseSaveGameInput headers", () => {
  const base = { source: "pgn-import", moveTree: [], pgn: "*", rootFen: START, currentFen: START };

  it("keeps known headers and drops unknown ones", () => {
    const input = parseSaveGameInput({
      ...base,
      headers: { white: "A", whiteElo: "2000", termination: null, orientationHint: "black", injected: "x" }
    });
    expect(input.headers).toEqual({ white: "A", whiteElo: "2000", termination: null, orientationHint: "black" });
  });

  it("rejects headers that aren't text", () => {
    expect(() => parseSaveGameInput({ ...base, headers: { white: 42 } })).toThrow();
    expect(() => parseSaveGameInput({ ...base, headers: { orientationHint: "up" } })).toThrow();
  });
});
