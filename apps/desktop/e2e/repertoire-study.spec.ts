// Repertoire study journeys (failed writes, practice eligibility, read failures) through the built
// app; how to run them: playwright.config.ts.
import type { ElectronApplication, Page } from "@playwright/test";
import type { ChaturangaApi } from "../../../packages/shared/src/ipc/chaturanga-api";
import { expect, sidebar, skipWelcome, test } from "./app";

const REPERTOIRE = "White repertoire e2e";

/**
 * A White repertoire with a chapter of 1. e4 e5 2. Nf3 Nc6 3. Bc4, which "Study" opens at its
 * start, through the preload bridge.
 */
function seedRepertoire(page: Page, repertoire = REPERTOIRE) {
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
  }, repertoire);
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

async function openStudy(page: Page, repertoire = REPERTOIRE) {
  await sidebar(page).getByRole("button", { name: "Repertoire", exact: true }).click();
  await page.getByRole("button", { name: `Study ${repertoire}`, exact: true }).click();
}

async function backToHub(page: Page) {
  await page
    .getByRole("navigation", { name: "Repertoire location" })
    .getByRole("button", { name: "Repertoire", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: `Study ${REPERTOIRE}`, exact: true })
  ).toBeVisible();
}

test("a refused practice prompt keeps its text through leaving study, then Retry saves it", async ({
  launch
}) => {
  const { app, page } = await launch();
  await skipWelcome(page);
  await seedRepertoire(page);
  await openStudy(page);
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  const prompt = page.getByRole("textbox", { name: /^Prompt/ });
  await expect(prompt).toBeEnabled();
  await expect(prompt).toHaveAttribute("maxlength", "2000");

  const restore = await refuseInvoke(app, "repertoires:updateDecision", "Simulated write failure");
  await prompt.fill("Take the centre");
  await prompt.press("Tab");
  await expect(studyPanel(page).getByRole("alert")).toContainText("Simulated write failure");
  await expect(titlebar(page)).toContainText("Unsaved — Simulated write failure");
  await expect(titlebar(page)).not.toContainText("Saved");

  // Leaving and coming back keeps the typed prompt and its failed state.
  await backToHub(page);
  await page.getByRole("button", { name: `Study ${REPERTOIRE}`, exact: true }).click();
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  await expect(prompt).toHaveValue("Take the centre");
  await expect(titlebar(page)).toContainText("Unsaved — Simulated write failure");

  await restore();
  await titlebar(page).getByRole("button", { name: "Retry", exact: true }).click();
  await expect(titlebar(page)).toContainText("Saved");
  await expect(studyPanel(page).getByRole("alert")).toHaveCount(0);
  await expect(prompt).toHaveValue("Take the centre");
  // Saved for real: with the draft gone, a fresh visit shows the stored prompt.
  await backToHub(page);
  await page.getByRole("button", { name: `Study ${REPERTOIRE}`, exact: true }).click();
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  await expect(prompt).toHaveValue("Take the centre");
  await expect(titlebar(page)).toContainText("Saved");
});

test("another repertoire's refused hint doesn't keep this one's chapter from Analyze", async ({
  launch
}) => {
  const OTHER = "Second repertoire e2e";
  const { app, page } = await launch();
  await skipWelcome(page);
  await seedRepertoire(page);
  await seedRepertoire(page, OTHER);

  // The other repertoire's hint write fails; its text stays unsaved there.
  await openStudy(page, OTHER);
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  const hint = page.getByRole("textbox", { name: /^Hint/ });
  await expect(hint).toBeEnabled();
  const restore = await refuseInvoke(app, "repertoires:updateDecision", "Simulated write failure");
  await hint.fill("The knight belongs on f3");
  await hint.press("Tab");
  await expect(studyPanel(page).getByRole("alert")).toContainText("Simulated write failure");
  await backToHub(page);

  // This repertoire's chapter is saved: Analyze opens.
  await page.getByRole("button", { name: `Study ${REPERTOIRE}`, exact: true }).click();
  await expect(titlebar(page)).toContainText("Saved");
  await studyPanel(page).getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(page.getByText("Analysing a copy of the chapter line")).toBeVisible();
  await expect(page.getByText("This chapter couldn't be saved")).toHaveCount(0);

  // The other repertoire still holds its hint with Retry and Discard.
  await restore();
  await openStudy(page, OTHER);
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  await expect(hint).toHaveValue("The knight belongs on f3");
  await expect(titlebar(page)).toContainText("Unsaved — Simulated write failure");
  const notice = studyPanel(page).getByRole("alert");
  await expect(notice.getByRole("button", { name: "Discard", exact: true })).toBeVisible();
  await notice.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(titlebar(page)).toContainText("Saved");
  await expect(hint).toHaveValue("The knight belongs on f3");
});

test("a chapter left out of practice still offers Analyze and Play from here", async ({
  launch
}) => {
  const { page } = await launch();
  await skipWelcome(page);
  await seedRepertoire(page);
  await openStudy(page);
  await page.getByRole("tab", { name: "Chapters", exact: true }).click();
  await page.getByRole("switch", { name: "Disable Italian for practice", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "Enable Italian for practice", exact: true })
  ).toBeVisible();

  const panel = studyPanel(page);
  await expect(
    panel.getByRole("button", { name: "Practice this chapter", exact: true })
  ).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Play from here", exact: true })).toBeEnabled();
  const analyze = panel.getByRole("button", { name: "Analyze", exact: true });
  await expect(analyze).toBeEnabled();
  await analyze.click();
  await expect(page.getByText("Analysing a copy of the chapter line")).toBeVisible();
});

test("a chapter that can't be read keeps the study page with Retry", async ({ launch }) => {
  const { app, page } = await launch();
  await skipWelcome(page);
  await seedRepertoire(page);
  const restore = await refuseInvoke(app, "repertoires:getChapter", "Simulated read failure");
  await openStudy(page);
  await expect(page.getByText("This chapter couldn't be opened")).toBeVisible();
  await expect(page.getByText("Simulated read failure")).toBeVisible();
  // Still on the study route: the hub's list is not shown, and the titlebar names the repertoire.
  await expect(page.getByRole("button", { name: `Study ${REPERTOIRE}`, exact: true })).toHaveCount(
    0
  );
  await expect(titlebar(page)).toContainText(REPERTOIRE);

  await restore();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Moves", exact: true })).toBeVisible();
  await expect(page.getByText("This chapter couldn't be opened")).toHaveCount(0);
});
