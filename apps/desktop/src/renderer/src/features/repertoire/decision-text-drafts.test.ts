import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type {
  DecisionSaveResult,
  RepertoireDecision,
  UpdateDecisionInput
} from "@chaturanga/shared/types/repertoire";
import { addLine, chapterOf, detailOf, rootNode } from "./__fixtures__/repertoire";
import { decisionDraftKey, decisionTextStatus } from "./repertoire-model";

vi.stubGlobal("window", globalThis);

const updateDecision = vi.fn<(input: UpdateDecisionInput) => Promise<DecisionSaveResult>>();
const getRepertoire = vi.fn<(id: string) => Promise<unknown>>();
const getDecision =
  vi.fn<(input: { repertoireId: string; positionKey: string }) => Promise<unknown>>();
(globalThis as unknown as { chaturanga: unknown }).chaturanga = {
  repertoires: { updateDecision, get: getRepertoire, getDecision },
  games: {}
};

const { useRepertoireWorkspaceStore } = await import("../../stores/repertoire-workspace-store");
const {
  discardDecisionText,
  discardDeletedRepertoireTexts,
  flushDecisionTexts,
  keepDecisionText,
  queueRepertoireWrite,
  retryDecisionTexts,
  saveDecisionText
} = await import("./decision-text-drafts");
const { flushChapterDraft, unsavedStudyCause } = await import("./useChapterAutosave");

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
    wrongMoveFeedback: input.patch.wrongMoveFeedback ?? {},
    paused: input.patch.paused ?? false
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
    getDecision.mockReset();
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

  it("merges feedback for one move into the stored feedback, read just before writing", async () => {
    const key = decisionDraftKey("r1", "k1", "feedback", "d2d4");
    store().setWrongMoveFeedback("r1", "k1", "d2d4", " We play 1.e4 ");
    getDecision.mockResolvedValueOnce({ wrongMoveFeedback: { c2c4: "Not the English" } });
    updateDecision.mockImplementationOnce(async (input) => saved(input, 5));
    expect(await saveDecisionText(queryClient, key, { flushChapter })).toBe(true);
    expect(getDecision).toHaveBeenCalledWith({ repertoireId: "r1", positionKey: "k1" });
    expect(updateDecision.mock.calls[0][0].patch).toEqual({
      wrongMoveFeedback: { c2c4: "Not the English", d2d4: "We play 1.e4" }
    });
    expect(store().decisionDrafts[key]).toBeUndefined();

    // Removing it: blank text leaves the other move's feedback.
    store().setWrongMoveFeedback("r1", "k1", "c2c4", "");
    getDecision.mockResolvedValueOnce({
      wrongMoveFeedback: { c2c4: "Not the English", d2d4: "We play 1.e4" }
    });
    updateDecision.mockImplementationOnce(async (input) => saved(input, 6));
    expect(
      await saveDecisionText(queryClient, decisionDraftKey("r1", "k1", "feedback", "c2c4"), {
        flushChapter
      })
    ).toBe(true);
    expect(updateDecision.mock.calls[1][0].patch).toEqual({
      wrongMoveFeedback: { d2d4: "We play 1.e4" }
    });
  });

  it("keeps a refused pause until Retry, and never reports it saved meanwhile", async () => {
    const key = decisionDraftKey("r1", "k1", "paused");
    store().setDecisionPaused("r1", "k1", true);
    updateDecision.mockRejectedValueOnce(new Error("disk full"));
    expect(await saveDecisionText(queryClient, key, { flushChapter })).toBe(false);
    expect(store().decisionDrafts[key]).toMatchObject({
      field: "paused",
      paused: true,
      status: "error",
      error: { message: "disk full", stale: false }
    });
    expect(decisionTextStatus(store().decisionDrafts, "r1")).toMatchObject({
      dirty: true,
      errorMessage: "disk full"
    });
    expect(await flushChapterDraft(queryClient)).toBe(false);

    updateDecision.mockImplementationOnce(async (input) => saved(input, 5));
    expect(await retryDecisionTexts(queryClient, "r1", flushChapter)).toBe(true);
    expect(updateDecision).toHaveBeenLastCalledWith({
      repertoireId: "r1",
      positionKey: "k1",
      expectedRevision: 4,
      patch: { paused: true }
    });
    expect(store().decisionDrafts[key]).toBeUndefined();
    expect(store().decisions.k1.paused).toBe(true);
    expect(decisionTextStatus(store().decisionDrafts, "r1").dirty).toBe(false);
  });

  it("drops the text of a deleted repertoire rather than block leaving", async () => {
    store().setDecisionText("r1", "k1", "prompt", "Develop");
    updateDecision.mockRejectedValueOnce(new Error("Invalid repertoireId: not found"));
    expect(await flushDecisionTexts(queryClient, flushChapter)).toBe(true);
    expect(store().decisionDrafts[PROMPT]).toBeUndefined();
  });

  it("doesn't hold back leaving one repertoire for another repertoire's failed draft", async () => {
    const other = decisionDraftKey("r2", "k9", "hint");
    const otherPending = decisionDraftKey("r2", "k8", "prompt");
    store().setDecisionText("r2", "k9", "hint", "Castle early");
    getRepertoire.mockResolvedValue(detailOf({ id: "r2", revision: 11 }));
    updateDecision.mockRejectedValueOnce(new Error("disk full"));
    expect(await saveDecisionText(queryClient, other, { flushChapter })).toBe(false);

    // r1's own prompt saves; r2's pending one is written too, its failed one waits for Retry.
    store().setDecisionText("r1", "k1", "prompt", "Develop");
    store().setDecisionText("r2", "k8", "prompt", "Fianchetto");
    updateDecision.mockImplementation(async (input) => saved(input, 12));
    expect(await flushChapterDraft(queryClient, ["r1"])).toBe(true);
    expect(store().decisionDrafts[PROMPT]).toBeUndefined();
    expect(store().decisionDrafts[otherPending]).toBeUndefined();
    expect(store().decisionDrafts[other].status).toBe("error");
    expect(updateDecision).toHaveBeenCalledTimes(3);
    expect(unsavedStudyCause("r1")).toBeNull();

    // Leaving r2 (or closing the window) is still held back by it.
    expect(await flushChapterDraft(queryClient, ["r2"])).toBe(false);
    expect(await flushChapterDraft(queryClient)).toBe(false);
    expect(unsavedStudyCause("r2")).toBe("decision");
  });

  it("names why a study flush held back: the chapter, a failed change, or only stale ones", async () => {
    store().setDecisionText("r1", "k1", "prompt", "Develop");
    updateDecision.mockRejectedValueOnce(
      new Error("Invalid expectedRevision: repertoire changed (stored 6, expected 4)")
    );
    expect(await flushChapterDraft(queryClient, ["r1"])).toBe(false);
    expect(unsavedStudyCause("r1")).toBe("stale-decision");

    store().setDecisionText("r1", "k1", "hint", "Knight to f3");
    store().decisionTextFailed(HINT, "disk full", false);
    expect(unsavedStudyCause("r1")).toBe("decision");

    store().saveFailed("disk full", false);
    expect(unsavedStudyCause("r1")).toBe("chapter");
  });

  it("drops the drafts of a repertoire deleted since (not found when written, or by the hub)", async () => {
    // Not found when one of its drafts is written: all of its drafts go.
    store().setDecisionText("r2", "k1", "prompt", "Develop");
    store().setDecisionText("r2", "k2", "hint", "Knight to f3");
    getRepertoire.mockResolvedValueOnce(detailOf({ id: "r2", revision: 3 }));
    updateDecision.mockRejectedValueOnce(new Error("Invalid repertoireId: not found"));
    expect(
      await saveDecisionText(queryClient, decisionDraftKey("r2", "k1", "prompt"), {
        flushChapter
      })
    ).toBe(true);
    expect(store().decisionDrafts).toEqual({});

    // The hub's list doesn't have it, and reading it says it's gone; an archived one (unlisted
    // but readable) and a listed one stay.
    store().setDecisionText("r1", "k1", "prompt", "Listed");
    store().setDecisionText("r3", "k1", "prompt", "Deleted");
    store().setDecisionText("r4", "k1", "prompt", "Archived");
    getRepertoire.mockImplementation(async (id) => {
      if (id === "r3") throw new Error("Invalid repertoireId: not found");
      return detailOf({ id });
    });
    await discardDeletedRepertoireTexts(queryClient, ["r1"]);
    expect(Object.values(store().decisionDrafts).map((draft) => draft.repertoireId)).toEqual([
      "r1",
      "r4"
    ]);
    expect(getRepertoire).not.toHaveBeenCalledWith("r1");
  });

  it("Keep mine drops a stale draft whose repertoire was deleted since", async () => {
    store().setDecisionText("r1", "k1", "prompt", "Develop");
    store().decisionTextFailed(PROMPT, "Invalid expectedRevision: repertoire changed", true);
    getRepertoire.mockRejectedValueOnce(new Error("Invalid repertoireId: not found"));
    expect(await keepDecisionText(queryClient, PROMPT, flushChapter)).toBe(true);
    expect(store().decisionDrafts[PROMPT]).toBeUndefined();
    expect(updateDecision).not.toHaveBeenCalled();
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
