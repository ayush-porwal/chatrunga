import { describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) =>
      handlers.set(channel, handler)
  },
  BrowserWindow: { fromWebContents: () => null }
}));
const calls: [string, unknown[]][] = [];
vi.mock("../repertoire/service", () => {
  const names = [
    "archiveRepertoire",
    "cancelImport",
    "commitImport",
    "createRepertoire",
    "duplicateRepertoire",
    "endPractice",
    "exportRepertoire",
    "getChapter",
    "getDecision",
    "getDueSummary",
    "getRepertoire",
    "listRepertoires",
    "previewImport",
    "recordAttempt",
    "recordPracticeAction",
    "removeChapter",
    "removeRepertoire",
    "resumePractice",
    "saveChapter",
    "saveWorkspace",
    "startPractice",
    "updateDecision",
    "updateMetadata"
  ];
  return Object.fromEntries(
    names.map((name) => [
      name,
      (...args: unknown[]) => {
        calls.push([name, args]);
        return name;
      }
    ])
  );
});

const { registerRepertoireIpc } = await import("./repertoire-handler");

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("registerRepertoireIpc", () => {
  it("parses every input before calling the service", () => {
    registerRepertoireIpc();
    const invoke = (channel: string, ...args: unknown[]) =>
      handlers.get(`repertoires:${channel}`)!({ sender: {} }, ...args);
    const chapter = {
      id: "c1",
      title: "Main",
      sortOrder: 0,
      kind: "opening",
      enabled: true,
      rootFen: START,
      tree: [],
      nodeMeta: {},
      headers: {}
    };
    const valid: [string, unknown, string][] = [
      ["list", { color: "all", query: "e4", archived: false }, "listRepertoires"],
      ["get", "r1", "getRepertoire"],
      ["getChapter", { repertoireId: "r1", chapterId: "c1" }, "getChapter"],
      ["getDecision", { repertoireId: "r1", positionKey: "v1:key" }, "getDecision"],
      ["create", { name: "Mine", color: "white", tags: ["a"], rootFen: START }, "createRepertoire"],
      [
        "updateMetadata",
        { id: "r1", expectedRevision: 1, patch: { name: "New" } },
        "updateMetadata"
      ],
      ["saveChapter", { repertoireId: "r1", expectedRevision: 1, chapter }, "saveChapter"],
      [
        "updateDecision",
        {
          repertoireId: "r1",
          positionKey: "v1:key",
          expectedRevision: 1,
          patch: {
            acceptedUcis: ["e2e4"],
            preferredUci: null,
            wrongMoveFeedback: { d2d4: "no" },
            paused: false
          }
        },
        "updateDecision"
      ],
      [
        "removeChapter",
        { repertoireId: "r1", chapterId: "c1", expectedRevision: 1 },
        "removeChapter"
      ],
      ["duplicate", { id: "r1" }, "duplicateRepertoire"],
      ["archive", { id: "r1", archived: true, expectedRevision: 1 }, "archiveRepertoire"],
      ["remove", { id: "r1", expectedRevision: 1 }, "removeRepertoire"],
      ["previewImport", { pgn: "1. e4 *" }, "previewImport"],
      [
        "commitImport",
        {
          jobId: "j",
          repertoireId: "r1",
          expectedRevision: 1,
          selections: [
            { gameIndex: 0, title: "A", kind: "reference", include: true, excludeNodeIds: ["n2"] }
          ]
        },
        "commitImport"
      ],
      ["cancelImport", "j", "cancelImport"],
      ["export", { repertoireId: "r1", chapterIds: ["c1"] }, "exportRepertoire"],
      [
        "startPractice",
        {
          repertoireId: "r1",
          mode: "review-due",
          chapterIds: ["c1"],
          maxDepthPlies: 8,
          cardLimit: 5,
          newCardLimit: 0
        },
        "startPractice"
      ],
      ["resumePractice", "s1", "resumePractice"],
      [
        "recordPracticeAction",
        { sessionId: "s1", queueItemId: "q1", action: { kind: "hint" } },
        "recordPracticeAction"
      ],
      [
        "recordAttempt",
        { sessionId: "s1", queueItemId: "q1", attemptId: "a1", uci: "e7e8n" },
        "recordAttempt"
      ],
      ["endPractice", "s1", "endPractice"],
      [
        "saveWorkspace",
        {
          repertoireId: "r1",
          workspace: {
            lastChapterId: "c1",
            lastNodeId: null,
            orientation: "black",
            practiceDraft: { repertoireId: "r1", mode: "learn-new" }
          }
        },
        "saveWorkspace"
      ]
    ];
    for (const [channel, input, method] of valid) {
      expect(invoke(channel, input)).toBe(method);
    }
    expect(invoke("getDueSummary")).toBe("getDueSummary");
    expect(invoke("previewImport", { path: "/tmp/a.pgn" })).toBe("previewImport");
    expect(invoke("list", undefined)).toBe("listRepertoires");
    expect(calls.find(([name]) => name === "recordAttempt")?.[1][0]).toEqual({
      sessionId: "s1",
      queueItemId: "q1",
      attemptId: "a1",
      uci: "e7e8n"
    });
  });

  it("rejects malformed inputs with Invalid … messages", () => {
    const invoke = (channel: string, ...args: unknown[]) =>
      handlers.get(`repertoires:${channel}`)!({ sender: {} }, ...args);
    expect(() => invoke("create", { name: "x", color: "red" })).toThrow(
      "Invalid color: expected white or black"
    );
    expect(() =>
      invoke("recordAttempt", { sessionId: "s", queueItemId: "q", attemptId: "a", uci: "e2e9" })
    ).toThrow(/Invalid uci/);
    expect(() =>
      invoke("saveChapter", { repertoireId: "r", expectedRevision: 1, chapter: { tree: {} } })
    ).toThrow(/Invalid chapter tree/);
    expect(() => invoke("updateMetadata", { id: "r", expectedRevision: -1, patch: {} })).toThrow(
      /expectedRevision/
    );
    expect(() => invoke("startPractice", { repertoireId: "r", mode: "rehearse" })).toThrow(
      /practice mode/
    );
    expect(() =>
      invoke("startPractice", { repertoireId: "r", mode: "learn-new", cardLimit: 0 })
    ).toThrow(/cardLimit/);
    expect(() =>
      invoke("recordPracticeAction", { sessionId: "s", queueItemId: "q", action: { kind: "peek" } })
    ).toThrow(/practice action/);
    expect(() => invoke("previewImport", { path: "relative.pgn" })).toThrow(/absolute path/);
    expect(() =>
      invoke("commitImport", { jobId: "j", repertoireId: "r", expectedRevision: 1, selections: {} })
    ).toThrow(/selections/);
    expect(() =>
      invoke("updateDecision", {
        repertoireId: "r",
        positionKey: "",
        expectedRevision: 1,
        patch: {}
      })
    ).toThrow(/positionKey/);
    expect(() =>
      invoke("updateDecision", {
        repertoireId: "r",
        positionKey: "k",
        expectedRevision: 1,
        patch: { acceptedUcis: "e2e4" }
      })
    ).toThrow(/acceptedUcis/);
    expect(() =>
      invoke("saveWorkspace", { repertoireId: "r", workspace: { orientation: "up" } })
    ).toThrow(/orientation/);
    expect(() => invoke("getChapter", { repertoireId: "r" })).toThrow(/chapterId/);
    expect(() => invoke("getDecision", { repertoireId: "r", positionKey: " " })).toThrow(
      /positionKey/
    );
    expect(() =>
      invoke("getDecision", { repertoireId: "r", positionKey: "k".repeat(201) })
    ).toThrow(/positionKey/);
  });
});
