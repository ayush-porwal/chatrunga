import { describe, expect, it } from "vitest";
import { GAME_SEARCH_MAX_LENGTH } from "@chaturanga/shared/types/chess";
import { REPERTOIRE_METADATA_LIMITS } from "@chaturanga/shared/types/repertoire";
import {
  asAbsolutePath,
  asFen,
  asId,
  asLichessId,
  asLichessUci,
  asUciMoves,
  parseAddFromGameInput,
  parseAnalysePositionsInput,
  parseDefaultFileName,
  parseDialogFilters,
  parseEngineInput,
  parseEnginePatch,
  parseGameLinkQuery,
  parseGameListQuery,
  parseLichessAiChallengeInput,
  parseLichessChallengeInput,
  parseChesscomConnectInput,
  parseDisconnectInput,
  parseLichessSeekInput,
  parsePgnText,
  parsePractisedElsewhereInput,
  parsePreviewImportInput,
  parseProbeEvalInput,
  parseListLimit,
  parsePuzzleSampleInput,
  parseRecordPuzzleAttemptInput,
  parseRemoveGameLink,
  parseLinkGameInput,
  parseReviewGameInput,
  parseSaveGameInput,
  parseSettingKey,
  parseSettingsPatch,
  parseUpdateRepertoireMetadataInput,
  parseStartAnalysisInput,
  parseStartGameInput
} from "./validate";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

describe("primitive validators", () => {
  it("accepts ids and rejects empty / multi-line ones", () => {
    expect(asId(" abc ")).toBe("abc");
    expect(() => asId("")).toThrow(/Invalid id/);
    expect(() => asId("a\nb")).toThrow(/expected a non-empty identifier/);
    expect(() => asId(42)).toThrow(/Invalid id: expected a string/);
    expect(() => asId("x".repeat(201))).toThrow(/too long/);
  });

  it("requires absolute paths", () => {
    expect(asAbsolutePath(" /usr/local/bin/stockfish ", "path")).toBe("/usr/local/bin/stockfish");
    expect(() => asAbsolutePath("stockfish", "path")).toThrow(/absolute/);
    expect(() => asAbsolutePath("/bin/sh\0", "path")).toThrow(/Invalid path/);
    expect(() => asAbsolutePath("", "path")).toThrow(/Invalid path/);
  });

  it("accepts legal FENs only, and never newlines (UCI command injection)", () => {
    expect(asFen(START)).toBe(START);
    expect(() => asFen(`${START}\nquit`)).toThrow(/control/);
    expect(() => asFen("8/8/8/8/8/8/8/8 w - - 0 1")).toThrow(/legal/);
    expect(() => asFen("hello")).toThrow(/Invalid FEN/);
  });

  it("accepts UCI moves only", () => {
    expect(asUciMoves(["e2e4", "e7e8q", "e1h1"])).toEqual(["e2e4", "e7e8q", "e1h1"]);
    expect(() => asUciMoves(["e4"])).toThrow(/UCI move/);
    expect(() => asUciMoves(["e2e4 quit"])).toThrow(/Invalid moves\[0\]: too long/);
    expect(() => asUciMoves("e2e4")).toThrow(/Invalid moves: expected an array/);
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
    expect(parseEnginePatch({ weightsPath: null, imagePath: "" })).toEqual({
      weightsPath: null,
      imagePath: null
    });
    expect(() => parseEnginePatch({ isDefault: "yes" })).toThrow(/boolean/);
  });
});

describe("engine session inputs", () => {
  it("parses engine games", () => {
    expect(
      parseStartGameInput({
        engineId: "sf",
        searchId: "s1",
        side: "black",
        fen: START,
        moves: ["e2e4"],
        clock: { wtime: 1, btime: 2, winc: 0, binc: 0 }
      })
    ).toEqual({
      engineId: "sf",
      searchId: "s1",
      side: "black",
      fen: START,
      moves: ["e2e4"],
      moveTimeMs: null,
      depth: null,
      clock: { wtime: 1, btime: 2, winc: 0, binc: 0 }
    });
    expect(() =>
      parseStartGameInput({
        engineId: "sf",
        searchId: "s1",
        side: "white",
        fen: START,
        moves: [],
        depth: -1
      })
    ).toThrow(/negative/);
    expect(() =>
      parseStartGameInput({
        engineId: "sf",
        searchId: "s1",
        side: "white",
        fen: START,
        clock: { wtime: "1" }
      })
    ).toThrow(/clock/);
    expect(() =>
      parseStartGameInput({ engineId: "sf", side: "white", fen: START, moves: [] })
    ).toThrow(/search id/);
    expect(() =>
      parseStartGameInput({ engineId: "sf", searchId: "s1", side: "white", fen: START, depth: 2.5 })
    ).toThrow(/whole/);
    expect(() =>
      parseStartGameInput({
        engineId: "sf",
        searchId: "s1",
        side: "white",
        fen: START,
        depth: 10_000
      })
    ).toThrow(/at most/);
    expect(() =>
      parseStartGameInput({ engineId: "sf", searchId: "s1", side: "purple", fen: START })
    ).toThrow(/side/);
  });

  it("parses analysis and probe requests", () => {
    expect(
      parseStartAnalysisInput({ engineId: "sf", searchId: "s2", fen: START, moves: [], multipv: 3 })
    ).toMatchObject({
      multipv: 3,
      searchId: "s2"
    });
    expect(parseProbeEvalInput({ engineId: "sf", fen: START, moves: [] }).movetimeMs).toBe(400);
    expect(
      parseProbeEvalInput({ engineId: "sf", fen: START, moves: [], movetimeMs: 1e9 }).movetimeMs
    ).toBe(60_000);
  });

  it("parses a review", () => {
    const review = parseReviewGameInput({
      reviewId: "r1",
      engineId: "sf",
      rootFen: START,
      moves: [
        {
          nodeId: "n1",
          ply: 1,
          san: "e4",
          uci: "e2e4",
          fenBefore: START,
          fenAfter: AFTER_E4,
          clockAfter: null
        }
      ],
      predictionEngineIds: ["maia-1", ""],
      multipv: 3
    });
    expect(review.predictionEngineIds).toEqual(["maia-1"]);
    expect(review.moves[0]).toMatchObject({ uci: "e2e4", clockAfter: null });
    expect(review.nodes).toBeNull();
    expect(parseReviewGameInput({ engineId: "sf", rootFen: START, moves: [] }).reviewId).toMatch(
      /^review-/
    );
    expect(() =>
      parseReviewGameInput({ engineId: "sf", rootFen: START, moves: [{ uci: "bad" }] })
    ).toThrow(/"bad" is not a UCI move/);
    expect(() => parseReviewGameInput({ engineId: "sf", rootFen: START })).toThrow(/moves/);
  });

  it("parses the rating context a review is resolved from", () => {
    const base = { engineId: "sf", rootFen: START, moves: [] };
    expect(
      parseReviewGameInput({
        ...base,
        rating: { side: "black", whiteElo: 1810, blackElo: null, speed: "blitz" }
      }).rating
    ).toEqual({ side: "black", whiteElo: 1810, blackElo: null, speed: "blitz" });
    expect(parseReviewGameInput({ ...base, rating: null }).rating).toBeNull();
    expect(() =>
      parseReviewGameInput({ ...base, rating: { side: "red", whiteElo: null, blackElo: null } })
    ).toThrow(/unknown side/);
    expect(() =>
      parseReviewGameInput({
        ...base,
        rating: { side: "white", whiteElo: 99_999, blackElo: null, speed: null }
      })
    ).toThrow(/white rating/);
    expect(() =>
      parseReviewGameInput({
        ...base,
        rating: { side: "white", whiteElo: null, blackElo: null, speed: "hyper" }
      })
    ).toThrow(/unknown speed/);
  });

  it("parses a few positions to analyse", () => {
    expect(
      parseAnalysePositionsInput({
        requestId: "p1",
        engineId: "sf",
        moveTimeMs: 120_000,
        positions: [{ fen: START, multipv: 3 }, { fen: AFTER_E4 }],
        extra: true
      })
    ).toEqual({
      requestId: "p1",
      engineId: "sf",
      moveTimeMs: 60_000,
      positions: [
        { fen: START, multipv: 3 },
        { fen: AFTER_E4, multipv: 1 }
      ]
    });
    const position = { fen: START, multipv: 1 };
    expect(() =>
      parseAnalysePositionsInput({ requestId: "p1", engineId: "sf", positions: [] })
    ).toThrow(/non-empty/);
    expect(() =>
      parseAnalysePositionsInput({
        requestId: "p1",
        engineId: "sf",
        positions: Array(5).fill(position)
      })
    ).toThrow(/too many/);
    expect(() =>
      parseAnalysePositionsInput({
        requestId: "p1",
        engineId: "sf",
        positions: [{ fen: START, multipv: 6 }]
      })
    ).toThrow(/at most/);
    expect(() =>
      parseAnalysePositionsInput({
        requestId: "p1",
        engineId: "sf",
        positions: [{ fen: "nonsense" }]
      })
    ).toThrow(/FEN/);
    expect(() => parseAnalysePositionsInput({ engineId: "sf", positions: [position] })).toThrow(
      /request id/
    );
  });
});

describe("library inputs", () => {
  const game = {
    source: "pgn-import",
    headers: {},
    rootFen: START,
    currentFen: START,
    pgn: "*",
    moveTree: []
  };

  it("shape-checks saved games", () => {
    expect(parseSaveGameInput({ ...game, id: null })).toMatchObject({
      id: null,
      source: "pgn-import"
    });
    expect(() => parseSaveGameInput({ ...game, source: "hosted" })).toThrow(/source/);
    expect(parseSaveGameInput({ ...game, source: "lichess" })).toMatchObject({ source: "lichess" });
    expect(parseSaveGameInput({ ...game, source: "chesscom" })).toMatchObject({
      source: "chesscom"
    });
    expect(() => parseSaveGameInput({ ...game, moveTree: {} })).toThrow(/moveTree/);
    expect(() => parseSaveGameInput({ ...game, pgn: 1 })).toThrow(/PGN/);
    expect(() => parseSaveGameInput({ ...game, review: "x" })).toThrow(/review/);
  });

  it("parses PGN imports and settings keys", () => {
    expect(parsePgnText({ pgn: "1. e4 *" })).toBe("1. e4 *");
    expect(() => parsePgnText({})).toThrow(/Invalid PGN/);
    expect(parseSettingKey("reviewMultiPv")).toBe("reviewMultiPv");
    expect(() => parseSettingKey("__proto__")).toThrow(/unknown key/);
  });

  it("parses dialog inputs", () => {
    expect(parseDialogFilters(undefined)).toEqual([]);
    expect(parseDialogFilters([{ name: "Images", extensions: ["png"] }])).toEqual([
      { name: "Images", extensions: ["png"] }
    ]);
    expect(() => parseDialogFilters([{ name: "x" }])).toThrow(/Invalid file filter extensions/);
    expect(parseDefaultFileName("../../etc/game.pgn")).toBe(".._.._etc_game.pgn");
    expect(parseDefaultFileName("  ")).toBe("chaturanga-game.pgn");
  });

  it("parses puzzle filters", () => {
    const parsed = parsePuzzleSampleInput({
      databaseId: "db",
      lichess: {
        ratingMin: 800,
        ratingMax: 1600,
        popularityMin: 0,
        lengths: [],
        themes: ["fork"],
        openings: [],
        side: "sideways"
      },
      position: { difficultyMin: 0, difficultyMax: 5, tags: [] }
    });
    expect(parsed.lichess?.side).toBe("any");
    expect(parsed.position?.difficultyMax).toBe(5);
    expect(() =>
      parsePuzzleSampleInput({ databaseId: "db", lichess: { ratingMin: "low" } })
    ).toThrow(/Invalid ratingMin/);
    expect(parsePuzzleSampleInput({ databaseId: "db", ids: ["a", "b"] }).ids).toEqual(["a", "b"]);
    expect(parsePuzzleSampleInput({ databaseId: "db" })).not.toHaveProperty("ids");
    expect(() => parsePuzzleSampleInput({ databaseId: "db", ids: "a" })).toThrow(/puzzle ids/);
  });

  it("parses a decided puzzle attempt", () => {
    const attempt = {
      attemptId: "a1",
      puzzleId: "00008",
      databaseId: "db",
      sourceId: "lichess-puzzles",
      outcome: "failed",
      puzzleRating: 1876,
      puzzleRatingDeviation: 76,
      themes: ["fork", "short"],
      wrongMoveCount: 1,
      solutionViewed: false,
      startedAt: 1000,
      decidedAt: 2000,
      completedAt: null
    };
    expect(parseRecordPuzzleAttemptInput(attempt)).toEqual(attempt);
    // An unrated set's puzzle has no rating; the themes may be left out.
    expect(
      parseRecordPuzzleAttemptInput({
        ...attempt,
        themes: undefined,
        puzzleRating: null,
        puzzleRatingDeviation: undefined
      })
    ).toMatchObject({ puzzleRating: null, puzzleRatingDeviation: null, themes: [] });
    expect(() => parseRecordPuzzleAttemptInput({ ...attempt, outcome: "pending" })).toThrow(
      /outcome/
    );
    expect(() => parseRecordPuzzleAttemptInput({ ...attempt, puzzleRating: -5 })).toThrow(/rating/);
    expect(() => parseRecordPuzzleAttemptInput({ ...attempt, wrongMoveCount: 1.5 })).toThrow(
      /Invalid wrong move count/
    );
    expect(() => parseRecordPuzzleAttemptInput({ ...attempt, solutionViewed: "no" })).toThrow(
      /Invalid solution viewed/
    );
    expect(() => parseRecordPuzzleAttemptInput({ ...attempt, attemptId: "" })).toThrow(
      /attempt id/
    );
  });

  it("bounds list limits", () => {
    expect(parseListLimit(undefined, 50, 100)).toBe(50);
    expect(parseListLimit(20, 50, 100)).toBe(20);
    expect(() => parseListLimit(0, 50, 100)).toThrow(/Invalid limit/);
    expect(() => parseListLimit(101, 50, 100)).toThrow(/Invalid limit/);
  });
});

describe("Lichess inputs", () => {
  it("accepts Lichess ids and UCI moves only (they become URL path segments)", () => {
    expect(asLichessId("abcd1234")).toBe("abcd1234");
    expect(asLichessId("abcd1234WXYZ")).toBe("abcd1234WXYZ");
    expect(() => asLichessId("abc")).toThrow(/Lichess id/);
    expect(() => asLichessId("abcd1234/../account")).toThrow(/Invalid Lichess id: too long/);
    expect(() => asLichessId("abcd 234")).toThrow(/not a Lichess id/);
    expect(asLichessUci("e7e8q")).toBe("e7e8q");
    expect(() => asLichessUci("e4")).toThrow(/UCI/);
    expect(() => asLichessUci("e2e4/")).toThrow(/"e2e4\/" is not a UCI move/);
  });

  it("parses seeks", () => {
    expect(
      parseLichessSeekInput({
        minutes: 10,
        incrementSec: 5,
        rated: true,
        ratingRange: [1400, 1800]
      })
    ).toEqual({
      minutes: 10,
      incrementSec: 5,
      rated: true,
      ratingRange: [1400, 1800]
    });
    expect(
      parseLichessSeekInput({ minutes: 1.5, incrementSec: 0, rated: false, ratingRange: null })
        .ratingRange
    ).toBeNull();
    expect(() => parseLichessSeekInput({ minutes: 200, incrementSec: 0, rated: true })).toThrow(
      /minutes/
    );
    expect(() => parseLichessSeekInput({ minutes: 10, incrementSec: 2.5, rated: true })).toThrow(
      /whole/
    );
    expect(() => parseLichessSeekInput({ minutes: 10, incrementSec: 0, rated: "yes" })).toThrow(
      /rated/
    );
    expect(() =>
      parseLichessSeekInput({
        minutes: 10,
        incrementSec: 0,
        rated: true,
        ratingRange: [1800, 1400]
      })
    ).toThrow(/rating range/);
    expect(() =>
      parseLichessSeekInput({ minutes: 10, incrementSec: 0, rated: true, ratingRange: [1] })
    ).toThrow(/Invalid rating range/);
  });

  it("parses challenges", () => {
    expect(
      parseLichessChallengeInput({
        username: " Georges_1 ",
        minutes: 15,
        incrementSec: 10,
        rated: false,
        color: "black"
      })
    ).toEqual({
      username: "Georges_1",
      minutes: 15,
      incrementSec: 10,
      rated: false,
      color: "black"
    });
    const valid = { username: "Salma", minutes: 10, incrementSec: 0, rated: true, color: "random" };
    expect(() => parseLichessChallengeInput({ ...valid, username: "a/b" })).toThrow(/username/);
    expect(() => parseLichessChallengeInput({ ...valid, username: "x" })).toThrow(/username/);
    expect(() => parseLichessChallengeInput({ ...valid, color: "green" })).toThrow(/color/);
    expect(() => parseLichessChallengeInput({ ...valid, incrementSec: 90 })).toThrow(/increment/);
    expect(() => parseLichessChallengeInput({ ...valid, minutes: 10.01 })).toThrow(/whole seconds/);
  });

  it("parses AI challenges and disconnect options", () => {
    expect(
      parseLichessAiChallengeInput({ level: 3, minutes: 10, incrementSec: 0, color: "white" })
    ).toEqual({
      level: 3,
      minutes: 10,
      incrementSec: 0,
      color: "white"
    });
    expect(() =>
      parseLichessAiChallengeInput({ level: 9, minutes: 10, incrementSec: 0, color: "white" })
    ).toThrow(/level/);
    expect(parseDisconnectInput({ removeGames: true })).toEqual({ removeGames: true });
    expect(() => parseDisconnectInput({})).toThrow(/removeGames/);
  });

  it("parses a chess.com username and the first import's reach", () => {
    expect(
      parseChesscomConnectInput({ username: " Ayush_p64 ", firstImport: "year", extra: 1 })
    ).toEqual({ username: "Ayush_p64", firstImport: "year" });
    expect(parseChesscomConnectInput({ username: "a-b", firstImport: "all" })).toEqual({
      username: "a-b",
      firstImport: "all"
    });
    // Anything that could leave the player's path (or isn't a username) is refused.
    for (const username of ["", "x", "../stats", "name with space", "ü", "a".repeat(51), 5])
      expect(() => parseChesscomConnectInput({ username, firstImport: "year" })).toThrow(
        /chess\.com username/
      );
    expect(() => parseChesscomConnectInput({ username: "erik", firstImport: "decade" })).toThrow(
      /first import/
    );
  });
});

describe("parseSaveGameInput headers", () => {
  const base = { source: "pgn-import", moveTree: [], pgn: "*", rootFen: START, currentFen: START };

  it("keeps known headers and drops unknown ones", () => {
    const input = parseSaveGameInput({
      ...base,
      headers: {
        white: "A",
        whiteElo: "2000",
        termination: null,
        orientationHint: "black",
        injected: "x"
      }
    });
    expect(input.headers).toEqual({
      white: "A",
      whiteElo: "2000",
      termination: null,
      orientationHint: "black"
    });
  });

  it("rejects headers that aren't text", () => {
    expect(() => parseSaveGameInput({ ...base, headers: { white: 42 } })).toThrow(
      /Invalid white header/
    );
    expect(() => parseSaveGameInput({ ...base, headers: { orientationHint: "up" } })).toThrow(
      /Invalid orientation header/
    );
  });
});

describe("parseSettingsPatch", () => {
  it("keeps known keys and refuses unknown or empty patches", () => {
    expect(parseSettingsPatch({ boardTheme: "green", boardSquareLight: null })).toEqual({
      boardTheme: "green",
      boardSquareLight: null
    });
    // A legacy combined piece set id keeps its look, unless the patch names a presentation itself.
    expect(parseSettingsPatch({ pieceStyle: "cburnettSoft" })).toEqual({
      pieceStyle: "cburnett",
      piecePresentation: "soft"
    });
    expect(
      parseSettingsPatch({ piecePresentation: "contrast", pieceStyle: "cburnettSoft" })
    ).toEqual({
      pieceStyle: "cburnett",
      piecePresentation: "contrast"
    });
    expect(() => parseSettingsPatch({ nope: 1 })).toThrow(/Invalid setting: unknown key/);
    expect(() => parseSettingsPatch({})).toThrow(/expected a few settings/);
    expect(() => parseSettingsPatch({ soundVolume: 9 })).toThrow(/soundVolume/);
  });

  it("parses a library page request from known fields only", () => {
    expect(parseGameListQuery(undefined)).toEqual({
      cursor: null,
      limit: undefined,
      search: undefined,
      tab: null,
      reviewed: false,
      excludeId: null
    });
    expect(
      parseGameListQuery({
        cursor: { updatedAt: 5, id: " g1 ", extra: 1 },
        limit: 50,
        search: "carlsen",
        tab: "chesscom",
        reviewed: true,
        excludeId: "board",
        sql: "DROP TABLE games"
      })
    ).toEqual({
      cursor: { updatedAt: 5, id: "g1" },
      limit: 50,
      search: "carlsen",
      tab: "chesscom",
      reviewed: true,
      excludeId: "board"
    });
    // The old filters are gone: a source is a tab, Reviewed a flag of its own.
    expect(() => parseGameListQuery({ tab: "puzzle" })).toThrow(/source/);
    expect(() => parseGameListQuery({ tab: "other" })).toThrow(/source/);
    expect(() => parseGameListQuery({ reviewed: "yes" })).toThrow(/reviewed/);
    expect(() => parseGameListQuery({ limit: -1 })).toThrow(/page size/);
    expect(() => parseGameListQuery({ limit: 1.5 })).toThrow(/page size/);
    expect(() => parseGameListQuery({ cursor: { updatedAt: "5", id: "g1" } })).toThrow(/cursor/);
    expect(() => parseGameListQuery({ cursor: { updatedAt: 5, id: "" } })).toThrow(/cursor/);
    expect(parseGameListQuery({ search: "x".repeat(GAME_SEARCH_MAX_LENGTH) }).search).toHaveLength(
      GAME_SEARCH_MAX_LENGTH
    );
    expect(() => parseGameListQuery({ search: "x".repeat(GAME_SEARCH_MAX_LENGTH + 1) })).toThrow(
      /search/
    );
    expect(() => parseGameListQuery("all")).toThrow(/Invalid game list query/);
  });
});

describe("add-from-game inputs", () => {
  const valid = {
    repertoireId: "r1",
    expectedRevision: 3,
    destination: { kind: "new-chapter", title: "Line", chapterKind: "opening" },
    source: { gameId: null, headers: { White: "A" }, rootFen: START, tree: [], nodeId: "n2" },
    scope: { kind: "subtree", fromNodeId: "n2", root: "standalone" },
    policy: { includedNodeIds: ["n3"], coveredNodeIds: [] }
  };

  it("parses the discriminated scope and destination and the policy ids", () => {
    expect(parseAddFromGameInput(valid)).toEqual(valid);
    expect(
      parseAddFromGameInput({ ...valid, scope: { kind: "whole-game", extra: 1 } }).scope
    ).toEqual({ kind: "whole-game" });
    expect(
      parseAddFromGameInput({
        ...valid,
        destination: { kind: "existing-chapter", chapterId: "c1" }
      }).destination
    ).toEqual({ kind: "existing-chapter", chapterId: "c1" });
    expect(
      parseAddFromGameInput({ ...valid, source: { ...valid.source, gameId: undefined } }).source
        .gameId
    ).toBeNull();
    expect(parseAddFromGameInput({ ...valid, policy: null }).policy).toBeNull();
    expect(() => parseAddFromGameInput({ ...valid, policy: undefined })).toThrow(/Invalid policy/);
  });

  it("refuses malformed input", () => {
    expect(() => parseAddFromGameInput({ ...valid, scope: { kind: "line" } })).toThrow(
      /Invalid scope/
    );
    expect(() =>
      parseAddFromGameInput({ ...valid, scope: { kind: "subtree", fromNodeId: "n2", root: "x" } })
    ).toThrow(/scope root/);
    expect(() => parseAddFromGameInput({ ...valid, destination: { kind: "x" } })).toThrow(
      /Invalid destination/
    );
    expect(() =>
      parseAddFromGameInput({ ...valid, source: { ...valid.source, tree: {} } })
    ).toThrow(/source tree/);
    expect(() =>
      parseAddFromGameInput({ ...valid, source: { ...valid.source, rootFen: "bad" } })
    ).toThrow(/source rootFen/);
    const headers = Object.fromEntries(
      Array.from({ length: 201 }, (_, index) => [`T${index}`, "v"])
    );
    expect(() => parseAddFromGameInput({ ...valid, source: { ...valid.source, headers } })).toThrow(
      /too many entries/
    );
    expect(() =>
      parseAddFromGameInput({ ...valid, policy: { includedNodeIds: [""], coveredNodeIds: [] } })
    ).toThrow(/includedNodeIds\[0\]/);
  });

  it("parses link queries and removals", () => {
    expect(parseGameLinkQuery({ repertoireId: "r1" })).toEqual({ repertoireId: "r1" });
    expect(parseGameLinkQuery({ repertoireId: "r1", chapterId: "c1" })).toEqual({
      repertoireId: "r1",
      chapterId: "c1"
    });
    expect(parseRemoveGameLink({ repertoireId: "r1", linkId: "l1" })).toEqual({
      repertoireId: "r1",
      linkId: "l1"
    });
    expect(() => parseRemoveGameLink({ repertoireId: "r1" })).toThrow(/linkId/);
  });

  it("parses game links", () => {
    const valid = {
      repertoireId: "r1",
      chapterId: null,
      gameId: "g1",
      gameNodeId: "n4",
      kind: "played",
      capturedPath: "1. e4"
    };
    expect(parseLinkGameInput(valid)).toEqual(valid);
    expect(
      parseLinkGameInput({ ...valid, chapterId: "c1", gameNodeId: undefined, kind: "model" })
    ).toMatchObject({
      chapterId: "c1",
      gameNodeId: null,
      kind: "model"
    });
    expect(() => parseLinkGameInput({ ...valid, kind: "source" })).toThrow(/kind/);
    expect(() => parseLinkGameInput({ ...valid, gameId: "" })).toThrow(/gameId/);
    expect(() => parseLinkGameInput({ ...valid, chapterId: 3 })).toThrow(/chapterId/);
    expect(() => parseLinkGameInput({ ...valid, capturedPath: "x".repeat(2001) })).toThrow(
      /capturedPath: too long/
    );
  });
});

describe("parsePractisedElsewhereInput", () => {
  it("accepts a chapter's position keys, trimmed, and refuses anything else", () => {
    expect(
      parsePractisedElsewhereInput({
        repertoireId: "r1",
        chapterId: "c1",
        positionKeys: [" v1:a "]
      })
    ).toEqual({ repertoireId: "r1", chapterId: "c1", positionKeys: ["v1:a"] });
    expect(() =>
      parsePractisedElsewhereInput({ repertoireId: "r1", chapterId: "c1", positionKeys: "v1:a" })
    ).toThrow("positionKeys");
    expect(() =>
      parsePractisedElsewhereInput({ repertoireId: "r1", chapterId: "c1", positionKeys: [" "] })
    ).toThrow("positionKeys");
    expect(() =>
      parsePractisedElsewhereInput({ repertoireId: "r1", chapterId: "", positionKeys: [] })
    ).toThrow("chapterId");
  });
});

describe("parsePreviewImportInput", () => {
  it("refuses text over 20 MiB with the import's size-limit message", () => {
    expect(() => parsePreviewImportInput({ pgn: "x".repeat(20 * 1024 * 1024 + 1) })).toThrow(
      "This PGN is larger than 20 MiB; split it and import it in parts."
    );
    expect(parsePreviewImportInput({ pgn: "1. e4 *", jobId: "job-1" })).toEqual({
      pgn: "1. e4 *",
      jobId: "job-1"
    });
  });
});

describe("parseUpdateRepertoireMetadataInput", () => {
  const limits = REPERTOIRE_METADATA_LIMITS;
  const parse = (patch: object) =>
    parseUpdateRepertoireMetadataInput({ id: "r1", expectedRevision: 3, patch });

  it("accepts metadata at the limits the renderer's forms enforce", () => {
    const tags = Array.from({ length: limits.tags }, () => "t".repeat(limits.tag));
    expect(
      parse({ name: "n".repeat(limits.name), description: "d".repeat(limits.description), tags })
        .patch
    ).toEqual({ name: "n".repeat(limits.name), description: "d".repeat(limits.description), tags });
  });

  it("refuses metadata past them", () => {
    expect(() => parse({ name: "n".repeat(limits.name + 1) })).toThrow(/name/);
    expect(() => parse({ description: "d".repeat(limits.description + 1) })).toThrow(/description/);
    expect(() => parse({ tags: ["t".repeat(limits.tag + 1)] })).toThrow(/tags/);
    expect(() =>
      parse({ tags: Array.from({ length: limits.tags + 1 }, (_, i) => `t${i}`) })
    ).toThrow(/tags/);
  });
});
