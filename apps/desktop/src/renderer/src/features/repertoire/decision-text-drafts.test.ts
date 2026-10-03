import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type {
  DecisionSaveResult,
  RepertoireDecision,
  UpdateDecisionInput
} from "@chaturanga/shared/types/repertoire";
import { addLine, chapterOf, detailOf, rootNode } from "./__fixtures__/repertoire";
import { decisionDraftKey } from "./repertoire-model";

vi.stubGlobal("window", globalThis);

const updateDecision = vi.fn<(input: UpdateDecisionInput) => Promise<DecisionSaveResult>>();
const getRepertoire = vi.fn<(id: string) => Promise<unknown>>();
(globalThis as unknown as { chaturanga: unknown }).chaturanga = {
  repertoires: { updateDecision, get: getRepertoire },
  games: {}
};

const { useRepertoireWorkspaceStore } = await import("../../stores/repertoire-workspace-store");
const {
  discardDecisionText,
  flushDecisionTexts,
  keepDecisionText,
  queueRepertoireWrite,
  retryDecisionTexts,
  saveDecisionText
} = await import("./decision-text-drafts");
const { flushChapterDraft } = await import("./useChapterAutosave");

const store = () => useRepertoireWorkspaceStore.getState();
const PROMPT = decisionDraftKey("r1", "k1", "prompt");
const HINT = decisionDraftKey("r1", "k1", "hint");

/** What the main process answers for a decision write that took. */
function saved(input: UpdateDecisionInput, revision: number): DecisionSaveResult {
  const decision: RepertoireDecision = {
    repertoireId: input.repertoireId,
    positionKey: input.positionKey,
    acceptedUcis: ["e2e4"],
    preferredUci: "e2e4",
    prompt: input.patch.prompt ?? null,
    hint: input.patch.hint ?? null,
    wrongMoveFeedback: {},
    paused: false
  } as RepertoireDecision;
  return {
    repertoire: detailOf({ id: input.repertoireId, revision }),
    decision
  } as DecisionSaveResult;
}

let queryClient: QueryClient;
let chapterSaved: boolean;
const flushChapter = vi.fn(async () => chapterSaved);

function openStudy() {
  const { tree } = addLine([rootNode()], "root", ["e2e4", "e7e5"], "w");
  store().loadChapter(detailOf(), chapterOf(tree));
}

describe("decision text drafts", () => {
  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    updateDecision.mockReset();
    getRepertoire.mockReset();
    flushChapter.mockClear();
    chapterSaved = true;
    store().reset();
    useRepertoireWorkspaceStore.setState({ decisionDrafts: {} });
    openStudy();
  });

  it("keeps a refused prompt with its error until Retry saves it", async () => {
    store().setDecisionText("r1", "k1", "prompt", "  Develop with tempo ");
    updateDecision.mockRejectedValueOnce(
      new Error("Error invoking remote method 'repertoires:updateDecision': Error: disk full")
    );
    expect(await saveDecisionText(queryClient, PROMPT, { flushChapter })).toBe(false);
    expect(store().decisionDrafts[PROMPT]).toMatchObject({
      text: "  Develop with tempo ",
      status: "error",
      error: { message: "disk full", stale: false }
    });

    // A navigation flush doesn't retry it on its own.
    expect(await flushDecisionTexts(queryClient, flushChapter)).toBe(false);
    expect(updateDecision).toHaveBeenCalledTimes(1);

    updateDecision.mockImplementationOnce(async (input) => saved(input, 5));
    expect(await retryDecisionTexts(queryClient, "r1", flushChapter)).toBe(true);
    expect(updateDecision).toHaveBeenLastCalledWith({
      repertoireId: "r1",
      positionKey: "k1",
      expectedRevision: 4,
      patch: { prompt: "Develop with tempo" }
    });
    expect(store().decisionDrafts[PROMPT]).toBeUndefined();
    expect(store().baseRevision).toBe(5);
    expect(store().decisions.k1.prompt).toBe("Develop with tempo");
  });

  it("saves the chapter first, and waits (pending) while it can't be", async () => {
    store().setDecisionText("r1", "k1", "hint", "Knight to f3");
    chapterSaved = false;
    expect(await saveDecisionText(queryClient, HINT, { flushChapter, retry: true })).toBe(false);
    expect(updateDecision).not.toHaveBeenCalled();
    expect(store().decisionDrafts[HINT].status).toBe("pending");

    chapterSaved = true;
    updateDecision.mockImplementationOnce(async (input) => saved(input, 5));
    expect(await flushDecisionTexts(queryClient, flushChapter)).toBe(true);
    expect(updateDecision.mock.calls[0][0].patch).toEqual({ hint: "Knight to f3" });
  });

  it("keeps text typed while its write ran", async () => {
    store().setDecisionText("r1", "k1", "prompt", "Develop");
    let finish!: () => void;
    updateDecision.mockImplementationOnce(
      (input) => new Promise((resolve) => (finish = () => resolve(saved(input, 5))))
    );
    const first = saveDecisionText(queryClient, PROMPT, { flushChapter });
    await vi.waitFor(() => expect(updateDecision).toHaveBeenCalled());
    store().setDecisionText("r1", "k1", "prompt", "Develop with tempo");
    finish();
    expect(await first).toBe(false);
    expect(store().decisionDrafts[PROMPT]).toMatchObject({
      text: "Develop with tempo",
      status: "pending"
    });
  });

  it("waits for Keep mine or Discard after a stale refusal", async () => {
    store().setDecisionText("r1", "k1", "prompt", "Develop");
    updateDecision.mockRejectedValueOnce(
      new Error("Invalid expectedRevision: repertoire changed (stored 6, expected 4)")
    );
    await saveDecisionText(queryClient, PROMPT, { flushChapter });
    expect(store().decisionDrafts[PROMPT].error).toEqual({
      message: "Invalid expectedRevision: repertoire changed (stored 6, expected 4)",
      stale: true
    });
    // Retry would only be refused again.
    expect(await retryDecisionTexts(queryClient, "r1", flushChapter)).toBe(false);
    expect(updateDecision).toHaveBeenCalledTimes(1);

    getRepertoire.mockResolvedValueOnce(detailOf({ revision: 6 }));
    updateDecision.mockImplementationOnce(async (input) => saved(input, 7));
    expect(await keepDecisionText(queryClient, PROMPT, flushChapter)).toBe(true);
    expect(updateDecision.mock.calls[1][0].expectedRevision).toBe(6);
    expect(store().decisionDrafts[PROMPT]).toBeUndefined();

    store().setDecisionText("r1", "k1", "hint", "Knight to f3");
    discardDecisionText(queryClient, HINT);
    expect(store().decisionDrafts[HINT]).toBeUndefined();
  });

  it("drops the text of a deleted repertoire rather than block leaving", async () => {
    store().setDecisionText("r1", "k1", "prompt", "Develop");
    updateDecision.mockRejectedValueOnce(new Error("Invalid repertoireId: not found"));
    expect(await flushDecisionTexts(queryClient, flushChapter)).toBe(true);
    expect(store().decisionDrafts[PROMPT]).toBeUndefined();
  });

  it("writes another repertoire's draft against its stored revision", async () => {
    const other = decisionDraftKey("r2", "k9", "prompt");
    store().setDecisionText("r2", "k9", "prompt", "Castle early");
    getRepertoire.mockResolvedValueOnce(detailOf({ id: "r2", revision: 11 }));
    updateDecision.mockImplementationOnce(async (input) => saved(input, 12));
    expect(await saveDecisionText(queryClient, other, { flushChapter })).toBe(true);
    // Its position is in no open draft: the open chapter isn't saved first.
    expect(flushChapter).not.toHaveBeenCalled();
    expect(updateDecision.mock.calls[0][0]).toMatchObject({
      repertoireId: "r2",
      expectedRevision: 11
    });
    expect(store().baseRevision).toBe(4);
  });

  it("runs writes one at a time", async () => {
    const order: string[] = [];
    let release!: () => void;
    const first = queueRepertoireWrite(
      () =>
        new Promise<void>((resolve) => {
          order.push("first started");
          release = () => {
            order.push("first done");
            resolve();
          };
        })
    );
    const failing = queueRepertoireWrite(async () => {
      order.push("second");
      throw new Error("refused");
    });
    const third = queueRepertoireWrite(async () => order.push("third"));
    await vi.waitFor(() => expect(order).toEqual(["first started"]));
    release();
    await first;
    await expect(failing).rejects.toThrow("refused");
    await third;
    expect(order).toEqual(["first started", "first done", "second", "third"]);
  });

  it("leaving study (flushChapterDraft) saves the chapter and the typed text", async () => {
    store().setDecisionText("r1", "k1", "prompt", "Develop");
    updateDecision.mockImplementationOnce(async (input) => saved(input, 5));
    expect(await flushChapterDraft(queryClient)).toBe(true);
    expect(store().decisionDrafts[PROMPT]).toBeUndefined();

    store().setDecisionText("r1", "k1", "prompt", "Develop again");
    updateDecision.mockRejectedValueOnce(new Error("disk full"));
    expect(await flushChapterDraft(queryClient)).toBe(false);
    expect(store().decisionDrafts[PROMPT].status).toBe("error");
  });
});
