// Repertoire authoring journeys (pausing a decision, wrong-move feedback, promoting a variation
// with undo / redo) through the built app; how to run them: playwright.config.ts.
import type { ElectronApplication, Page } from "@playwright/test";
import type { ChaturangaApi } from "../../../packages/shared/src/ipc/chaturanga-api";
import { clickSquare, expect, sidebar, skipWelcome, test } from "./app";

const REPERTOIRE = "White authoring e2e";

type Seeded = { repertoireId: string; chapterId: string };

/**
 * A White repertoire with a chapter of 1. e4 e5 2. Nf3 Nc6 3. Bc4 (three decisions of White's),
 * which "Study" opens at its start, through the preload bridge.
 */
function seedRepertoire(page: Page): Promise<Seeded> {
  return page.evaluate(async (name) => {
    const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga.repertoires;
    const created = await api.create({ name, color: "white" });
    const preview = await api.previewImport({
      pgn: '[Event "Italian"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 *'
    });
    const imported = await api.commitImport({
      repertoireId: created.id,
      jobId: preview.jobId,
      expectedRevision: created.revision,
      selections: preview.games.map((game) => ({
        gameIndex: game.index,
        title: "Italian",
        kind: "opening" as const,
        include: true
      }))
    });
    // A new repertoire starts with an empty chapter: "Study" opens the imported one instead.
    const chapter = imported.repertoire.chapters.find((item) => item.nodeCount > 0)!;
    await api.saveWorkspace({
      repertoireId: created.id,
      workspace: {
        lastChapterId: chapter.id,
        lastNodeId: "root",
        orientation: "white",
        practiceDraft: null
      }
    });
    return { repertoireId: created.id, chapterId: chapter.id };
  }, REPERTOIRE);
}

/** The SAN of the stored chapter's first moves from its start, in the chapter's order. */
function storedFirstMoves(page: Page, { repertoireId, chapterId }: Seeded) {
  return page.evaluate(
    async (ids) => {
      const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga.repertoires;
      const chapter = await api.getChapter(ids);
      const root = chapter.tree.find((node) => node.id === "root")!;
      return root.children.map((id) => chapter.tree.find((node) => node.id === id)!.san);
    },
    { repertoireId, chapterId }
  );
}

/**
 * Makes the main process refuse `channel` with `message` until the returned restore runs (the
 * service's own handler is put back as it was).
 */
async function refuseInvoke(app: ElectronApplication, channel: string, message: string) {
  await app.evaluate(
    ({ ipcMain }, [channel, message]) => {
      type Handlers = Map<string, unknown>;
      const handlers = (ipcMain as unknown as { _invokeHandlers: Handlers })._invokeHandlers;
      const original = handlers.get(channel);
      if (!original) throw new Error(`No handler for ${channel}`);
      const saved = globalThis as unknown as { __e2eHandlers?: Record<string, unknown> };
      saved.__e2eHandlers = { ...saved.__e2eHandlers, [channel]: original };
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, () => {
        throw new Error(message);
      });
    },
    [channel, message] as const
  );
  return () =>
    app.evaluate(({ ipcMain }, channel) => {
      type Handlers = Map<string, unknown>;
      const handlers = (ipcMain as unknown as { _invokeHandlers: Handlers })._invokeHandlers;
      const saved = globalThis as unknown as { __e2eHandlers: Record<string, unknown> };
      ipcMain.removeHandler(channel);
      handlers.set(channel, saved.__e2eHandlers[channel]);
    }, channel);
}

const titlebar = (page: Page) => page.getByRole("banner", { name: "Titlebar" });
const studyPanel = (page: Page) => page.getByRole("complementary", { name: "Repertoire study" });
const practicePanel = (page: Page) => page.getByRole("complementary", { name: "Practice" });

async function openStudy(page: Page) {
  await sidebar(page).getByRole("button", { name: "Repertoire", exact: true }).click();
  await page.getByRole("button", { name: `Study ${REPERTOIRE}`, exact: true }).click();
  await expect(page.getByRole("tab", { name: "Moves", exact: true })).toBeVisible();
}

/** Practice this chapter → Learn new → Start learning; resolves once the first card is shown. */
async function learnNew(page: Page) {
  await studyPanel(page)
    .getByRole("button", { name: "Practice this chapter", exact: true })
    .click();
  await page.getByRole("radio", { name: "Learn new", exact: true }).click();
  await page.getByRole("button", { name: "Start learning", exact: true }).click();
  await expect(practicePanel(page)).toBeVisible();
  await expect(page.getByText("Play your move on the board")).toBeVisible();
}

test("a paused decision is left out of practice, and resuming brings it back", async ({
  launch
}) => {
  const { page } = await launch();
  await skipWelcome(page);
  await seedRepertoire(page);
  await openStudy(page);

  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  const pause = page.getByRole("switch", { name: "Pause this decision", exact: true });
  await expect(pause).toBeEnabled();
  await expect(
    page
      .getByRole("region", { name: "Pause practice" })
      .getByText(/every chapter and transposition/)
  ).toBeVisible();
  await pause.click();
  await expect(
    page.getByRole("switch", { name: "Resume this decision", exact: true })
  ).toBeVisible();
  await expect(titlebar(page)).toContainText("Saved");
  await page.getByRole("tab", { name: "Moves", exact: true }).click();
  await expect(studyPanel(page).getByText("Paused in practice")).toBeVisible();

  // Two of the chapter's three decisions: the first card is 2. Nf3's, after its lead-up.
  await learnNew(page);
  await expect(practicePanel(page)).toContainText("1 of 2");
  await practicePanel(page).getByRole("button", { name: "End session", exact: true }).click();

  await openStudy(page);
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  await page.getByRole("switch", { name: "Resume this decision", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "Pause this decision", exact: true })
  ).toBeVisible();
  await expect(titlebar(page)).toContainText("Saved");
  await learnNew(page);
  await expect(practicePanel(page)).toContainText("1 of 3");
});

test("feedback for a wrong move survives a refused write and shows in practice", async ({
  launch
}) => {
  const { app, page } = await launch();
  await skipWelcome(page);
  await seedRepertoire(page);
  await openStudy(page);
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  const section = page.getByRole("region", { name: "Wrong-move feedback" });
  await expect(section.getByText(/every chapter and transposition/)).toBeVisible();
  // Accepted moves aren't offered.
  const move = section.getByRole("combobox", { name: "Wrong move" });
  await expect(move.getByRole("option", { name: "e4", exact: true })).toHaveCount(0);

  // A move and text picked after 1. e4 e5 don't carry over to the start position (Home).
  const blur = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const newText = section.getByRole("textbox", { name: "Feedback", exact: true });
  const addFeedback = section.getByRole("button", { name: "Add feedback", exact: true });
  await blur();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await move.selectOption({ label: "Bc4" });
  await newText.fill("Develop the knight first");
  await expect(addFeedback).toBeEnabled();
  await blur();
  await page.keyboard.press("Home");
  await expect(move.getByRole("option", { name: "d4", exact: true })).toHaveCount(1);
  await expect(move).toHaveValue("");
  await expect(newText).toHaveValue("");
  await expect(addFeedback).toBeDisabled();

  const restore = await refuseInvoke(app, "repertoires:updateDecision", "Simulated write failure");
  await move.selectOption({ label: "d4" });
  await section.getByRole("textbox", { name: "Feedback", exact: true }).fill("We open with 1.e4");
  await section.getByRole("button", { name: "Add feedback", exact: true }).click();
  const added = section.getByRole("textbox", { name: /^Feedback for d4/ });
  await expect(added).toHaveValue("We open with 1.e4");
  await expect(titlebar(page)).toContainText("Unsaved — Simulated write failure");
  await expect(studyPanel(page).getByRole("alert")).toContainText("feedback for d4");

  await restore();
  await titlebar(page).getByRole("button", { name: "Retry", exact: true }).click();
  await expect(titlebar(page)).toContainText("Saved");
  await expect(studyPanel(page).getByRole("alert")).toHaveCount(0);
  await expect(added).toHaveValue("We open with 1.e4");

  // The first card is 1. e4's: a wrong 1. d4 is graded with the feedback.
  await learnNew(page);
  await expect(practicePanel(page)).toContainText("1 of 3");
  await clickSquare(page, "d2");
  await clickSquare(page, "d4");
  await expect(practicePanel(page)).toContainText("This move is outside your repertoire.");
  await expect(practicePanel(page)).toContainText("We open with 1.e4");
});

test("a variation is promoted with P and the promotion undone and redone from the keyboard", async ({
  launch
}) => {
  const { page } = await launch();
  await skipWelcome(page);
  const seeded = await seedRepertoire(page);
  await openStudy(page);
  const undo = studyPanel(page).getByRole("button", { name: "Undo", exact: true });
  const redo = studyPanel(page).getByRole("button", { name: "Redo", exact: true });
  const promote = studyPanel(page).getByRole("button", { name: "Promote variation", exact: true });
  await expect(undo).toBeDisabled();

  // 1. d4 from the start: a variation after the chapter's 1. e4.
  await clickSquare(page, "d2");
  await clickSquare(page, "d4");
  await expect(titlebar(page)).toContainText("Saved");
  await expect.poll(() => storedFirstMoves(page, seeded)).toEqual(["e4", "d4"]);
  await expect(promote).toBeEnabled();

  await page.keyboard.press("p");
  await expect.poll(() => storedFirstMoves(page, seeded)).toEqual(["d4", "e4"]);
  await expect(promote).toBeDisabled();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => storedFirstMoves(page, seeded)).toEqual(["e4", "d4"]);
  await expect(redo).toBeEnabled();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(() => storedFirstMoves(page, seeded)).toEqual(["d4", "e4"]);
  await expect(titlebar(page)).toContainText("Saved");

  // Promoting changes the chapter's order only: 1. e4 is still the preferred answer.
  await page.keyboard.press("Home");
  await expect(
    studyPanel(page).getByRole("region", { name: "Choices at this position" })
  ).toContainText(/e4\s*Preferred/);

  // In a text field, ⌘Z / Ctrl+Z is the field's own: the tree stays as it is.
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  const comment = page.getByRole("textbox", { name: /^Comment on/ });
  await comment.fill("Queen's pawn first");
  await comment.press("ControlOrMeta+z");
  await page.getByRole("tab", { name: "Moves", exact: true }).click();
  await expect(titlebar(page)).toContainText("Saved");
  await expect.poll(() => storedFirstMoves(page, seeded)).toEqual(["d4", "e4"]);
});
