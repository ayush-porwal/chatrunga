// Repertoire authoring journeys (staging moves and adding them, pausing a decision, wrong-move
// feedback, promoting a variation with undo / redo, or from its move's menu) through the built
// app; how to run them: playwright.config.ts.
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

/** How many moves the stored chapter has. */
function storedMoveCount(page: Page, ids: Seeded) {
  return page.evaluate(async (ids) => {
    const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga.repertoires;
    return (await api.getChapter(ids)).tree.length - 1;
  }, ids);
}

/** Answers the app's next questions (window.confirm) with `answer`, keeping the last one asked. */
function answerConfirm(page: Page, answer: boolean) {
  return page.evaluate((answer) => {
    const asked = window as unknown as { lastConfirm?: string };
    window.confirm = (message?: string) => {
      asked.lastConfirm = message;
      return answer;
    };
  }, answer);
}

/** The last question window.confirm asked (see answerConfirm). */
function lastConfirm(page: Page) {
  return page.evaluate(() => (window as unknown as { lastConfirm?: string }).lastConfirm);
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

/**
 * Study's Practice (nothing is due, so the new decisions); resolves once the first card is shown.
 */
async function practise(page: Page) {
  await studyPanel(page).getByRole("button", { name: "Practice", exact: true }).click();
  await expect(practicePanel(page)).toBeVisible();
  await expect(page.getByText("Play your move on the board")).toBeVisible();
}

/** The New moves card (staged moves). */
const newMoves = (page: Page) => studyPanel(page).getByRole("status", { name: "New moves" });

/** The New moves card's Add: the staged moves join the open chapter as one edit. */
async function addStagedMoves(page: Page, count = 1) {
  await newMoves(page)
    .getByRole("button", { name: `Add ${count} move${count === 1 ? "" : "s"}`, exact: true })
    .click();
  await expect(newMoves(page)).toHaveCount(0);
}

/** The selected move's ⋯ (`san`; "Starting position" at the start). */
const moveActions = (page: Page, san: string) =>
  studyPanel(page).getByRole("button", { name: `${san} actions`, exact: true });

/** The selected move's menu → `item`. */
async function moveMenu(page: Page, san: string, item: string) {
  await moveActions(page, san).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}

/** Whether the selected move's menu offers `item` (the menu is closed again). */
async function moveMenuOffers(page: Page, san: string, item: string) {
  await moveActions(page, san).click();
  const menu = page.getByRole("menu", { name: `${san} actions` });
  await expect(menu).toBeVisible();
  const offered = (await menu.getByRole("menuitem", { name: item, exact: true }).count()) > 0;
  await moveActions(page, san).click();
  await expect(menu).toHaveCount(0);
  return offered;
}

/** "Edit hint & prompt…" on the selected position (`san`: the move leading to it). */
async function openPracticeTexts(page: Page, san: string) {
  await moveMenu(page, san, "Edit hint & prompt…");
  const dialog = page.getByRole("dialog", {
    name: san === "Starting position" ? "Practice at the start" : `Practice after ${san}`
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("a paused decision is left out of practice, and resuming brings it back", async ({
  launch
}) => {
  const { page } = await launch();
  await skipWelcome(page);
  await seedRepertoire(page);
  await openStudy(page);

  // The start's decision (1. e4), from the starting position's menu.
  await moveMenu(page, "Starting position", "Pause practice for this position");
  expect(await moveMenuOffers(page, "Starting position", "Resume practice for this position")).toBe(
    true
  );
  await expect(titlebar(page)).toContainText("Saved");

  // Two of the chapter's three decisions: the first card is 2. Nf3's, after its lead-up.
  await practise(page);
  await expect(practicePanel(page)).toContainText("1 of 2");
  await practicePanel(page).getByRole("button", { name: "End session", exact: true }).click();

  await openStudy(page);
  await studyPanel(page).getByRole("button", { name: "Starting position", exact: true }).click();
  await moveMenu(page, "Starting position", "Resume practice for this position");
  expect(await moveMenuOffers(page, "Starting position", "Pause practice for this position")).toBe(
    true
  );
  await expect(titlebar(page)).toContainText("Saved");
  await practise(page);
  await expect(practicePanel(page)).toContainText("1 of 3");
});

test("feedback for a wrong move survives a refused write and shows in practice", async ({
  launch
}) => {
  const { app, page } = await launch();
  await skipWelcome(page);
  await seedRepertoire(page);
  await openStudy(page);

  // A move and text picked after 1. e4 e5 belong to that position only: the start's are empty.
  await studyPanel(page)
    .getByRole("tree", { name: "Chapter moves" })
    .getByRole("button", { name: "e5", exact: true })
    .click();
  const afterE5 = await openPracticeTexts(page, "e5");
  await expect(afterE5).toContainText(/every chapter and transposition/);
  const e5Section = afterE5.getByRole("region", { name: "Wrong-move feedback" });
  await e5Section.getByRole("combobox", { name: "Wrong move" }).selectOption({ label: "Bc4" });
  await e5Section.getByRole("textbox", { name: "Feedback", exact: true }).fill("Knight first");
  await expect(e5Section.getByRole("button", { name: "Add feedback", exact: true })).toBeEnabled();
  await afterE5.getByRole("button", { name: "Done", exact: true }).click();
  await expect(afterE5).toBeHidden();

  await studyPanel(page).getByRole("button", { name: "Starting position", exact: true }).click();
  const dialog = await openPracticeTexts(page, "Starting position");
  const section = dialog.getByRole("region", { name: "Wrong-move feedback" });
  // Accepted moves aren't offered.
  const move = section.getByRole("combobox", { name: "Wrong move" });
  await expect(move.getByRole("option", { name: "e4", exact: true })).toHaveCount(0);
  const newText = section.getByRole("textbox", { name: "Feedback", exact: true });
  const addFeedback = section.getByRole("button", { name: "Add feedback", exact: true });
  await expect(move.getByRole("option", { name: "d4", exact: true })).toHaveCount(1);
  await expect(move).toHaveValue("");
  await expect(newText).toHaveValue("");
  await expect(addFeedback).toBeDisabled();

  const restore = await refuseInvoke(app, "repertoires:updateDecision", "Simulated write failure");
  await move.selectOption({ label: "d4" });
  await newText.fill("We open with 1.e4");
  await addFeedback.click();
  const added = section.getByRole("textbox", { name: /^Feedback for d4/ });
  await expect(added).toHaveValue("We open with 1.e4");
  await expect(titlebar(page)).toContainText("Unsaved — Simulated write failure");
  await expect(studyPanel(page).getByRole("alert")).toContainText("feedback for d4");
  // Done writes it again, refused again; the titlebar's Retry is behind the dialog.
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(studyPanel(page).getByRole("alert")).toContainText("feedback for d4");

  await restore();
  await titlebar(page).getByRole("button", { name: "Retry", exact: true }).click();
  await expect(titlebar(page)).toContainText("Saved");
  await expect(studyPanel(page).getByRole("alert")).toHaveCount(0);
  await openPracticeTexts(page, "Starting position");
  await expect(added).toHaveValue("We open with 1.e4");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toBeHidden();

  // The first card is 1. e4's: a wrong 1. d4 is graded with the feedback.
  await practise(page);
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
  await expect(undo).toBeDisabled();

  // 1. d4 from the start, staged then added: a variation after the chapter's 1. e4.
  await clickSquare(page, "d2");
  await clickSquare(page, "d4");
  await addStagedMoves(page);
  await expect(titlebar(page)).toContainText("Saved");
  await expect.poll(() => storedFirstMoves(page, seeded)).toEqual(["e4", "d4"]);
  expect(await moveMenuOffers(page, "d4", "Promote variation")).toBe(true);

  await page.keyboard.press("p");
  await expect.poll(() => storedFirstMoves(page, seeded)).toEqual(["d4", "e4"]);
  expect(await moveMenuOffers(page, "d4", "Promote variation")).toBe(false);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => storedFirstMoves(page, seeded)).toEqual(["e4", "d4"]);
  await expect(redo).toBeEnabled();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(() => storedFirstMoves(page, seeded)).toEqual(["d4", "e4"]);
  await expect(titlebar(page)).toContainText("Saved");

  // In a text field, ⌘Z / Ctrl+Z is the field's own: the tree stays as it is.
  await moveMenu(page, "d4", "Edit comment…");
  const commentDialog = page.getByRole("dialog", { name: "Comment on d4" });
  const comment = commentDialog.getByRole("textbox", { name: /^Comment on d4/ });
  await comment.fill("Queen's pawn first");
  await comment.press("ControlOrMeta+z");
  await commentDialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(commentDialog).toBeHidden();
  await expect(titlebar(page)).toContainText("Saved");
  await expect.poll(() => storedFirstMoves(page, seeded)).toEqual(["d4", "e4"]);
});

test("a variation is promoted from its move's menu, opened with a right-click", async ({
  launch
}) => {
  const { page } = await launch();
  await skipWelcome(page);
  const seeded = await seedRepertoire(page);
  await openStudy(page);
  const tree = page.getByRole("tree", { name: "Chapter moves" });

  // 1. d4 from the start, staged then added: a variation row under the chapter's 1. e4.
  await clickSquare(page, "d2");
  await clickSquare(page, "d4");
  await addStagedMoves(page);
  const row = tree.getByRole("group", { name: "Variation: 1. d4" });
  await expect(row).toBeVisible();
  const d4 = row.getByRole("button", { name: "d4", exact: true });
  await expect(d4).toHaveAttribute("aria-current", "step");

  await d4.click({ button: "right" });
  await page
    .getByRole("menu", { name: "d4 actions" })
    .getByRole("menuitem", { name: "Promote variation", exact: true })
    .click();
  await expect.poll(() => storedFirstMoves(page, seeded)).toEqual(["d4", "e4"]);
  // 1. e4 is the variation now, its whole line in one row.
  await expect(
    tree.getByRole("group", { name: "Variation: 1. e4 e5 2. Nf3 Nc6 3. Bc4" })
  ).toBeVisible();
  await expect(tree.getByRole("group", { name: /^Variation: 1\. d4/ })).toHaveCount(0);
});

test("a board move is staged, explained and added as one undoable edit; leaving with one asks first", async ({
  launch
}) => {
  const { page } = await launch();
  await skipWelcome(page);
  const seeded = await seedRepertoire(page);
  await openStudy(page);
  const tree = page.getByRole("tree", { name: "Chapter moves" });

  // After 1. e4 e5 2. Nf3 Nc6 3. Bc4: 3... Nf6 4. Ng5, both new, staged and selected.
  await tree.getByRole("button", { name: "Bc4", exact: true }).click();
  await clickSquare(page, "g8");
  await clickSquare(page, "f6");
  await clickSquare(page, "f3");
  await clickSquare(page, "g5");
  await expect(tree.getByRole("button", { name: "Ng5", exact: true })).toHaveAttribute(
    "aria-current",
    "step"
  );
  await expect(newMoves(page)).toContainText("3…Nf6 becomes a reply you prepare for.");
  await expect(newMoves(page)).toContainText("4.Ng5 becomes your move here.");
  await expect(newMoves(page)).toContainText("1 new practice move");
  // Nothing is saved while they are staged.
  expect(await storedMoveCount(page, seeded)).toBe(5);

  // × drops a move and what follows it.
  await newMoves(page).getByRole("button", { name: "Drop 4.Ng5", exact: true }).click();
  await expect(newMoves(page)).toContainText(
    "3…Nf6 is a reply you'll cover; play your answer to practise it."
  );
  await expect(newMoves(page)).toContainText("No new practice moves");

  // Played again and added: both moves in one edit, which one Undo takes back.
  await clickSquare(page, "f3");
  await clickSquare(page, "g5");
  await addStagedMoves(page, 2);
  await expect(titlebar(page)).toContainText("Saved");
  await expect.poll(() => storedMoveCount(page, seeded)).toBe(7);
  await studyPanel(page).getByRole("button", { name: "Undo", exact: true }).click();
  await expect(titlebar(page)).toContainText("Saved");
  await expect.poll(() => storedMoveCount(page, seeded)).toBe(5);

  // Leaving Study with a staged move asks first: staying keeps it, discarding leaves.
  await clickSquare(page, "g8");
  await clickSquare(page, "f6");
  await expect(newMoves(page)).toBeVisible();
  await answerConfirm(page, false);
  await sidebar(page).getByRole("button", { name: "Repertoire", exact: true }).click();
  expect(await lastConfirm(page)).toBe("Discard 1 unsaved move?");
  await expect(newMoves(page)).toBeVisible();
  await answerConfirm(page, true);
  await sidebar(page).getByRole("button", { name: "Repertoire", exact: true }).click();
  await expect(studyPanel(page)).toHaveCount(0);
  expect(await storedMoveCount(page, seeded)).toBe(5);
});
