// Back / Forward between screens: library → game → repertoire study and back again, and Back to
// screens deleted since. How to run them: playwright.config.ts.
import type { Page } from "@playwright/test";
import type { ChaturangaApi } from "../../../packages/shared/src/ipc/chaturanga-api";
import { clickSquare, expect, importPgnFile, sidebar, skipWelcome, test } from "./app";
import { RUY_LOPEZ_PGN, writePgn } from "./fixtures";

const SICILIAN_PGN = `[Event "E2E navigation"]
[White "Gamma"]
[Black "Delta"]
[Result "*"]

1. e4 c5 2. Nf3 d6 *
`;

const REPERTOIRE = "Navigation repertoire";

/** A white repertoire with two imported chapters, through the preload bridge (set-up, not the journey). */
function seedRepertoire(page: Page): Promise<{ id: string }> {
  return page.evaluate(async (name) => {
    const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga.repertoires;
    const created = await api.create({ name, color: "white" });
    const preview = await api.previewImport({
      pgn:
        '[Event "Italian"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 *\n\n' +
        '[Event "Scotch"]\n\n1. e4 e5 2. Nf3 Nc6 3. d4 *'
    });
    await api.commitImport({
      repertoireId: created.id,
      jobId: preview.jobId,
      expectedRevision: created.revision,
      selections: preview.games.map((game) => ({
        gameIndex: game.index,
        title: game.index === 0 ? "Italian" : "Scotch",
        kind: "opening" as const,
        include: true
      }))
    });
    return { id: created.id };
  }, REPERTOIRE);
}

const titlebar = (page: Page) => page.getByRole("banner", { name: "Titlebar" });
const back = (page: Page) => titlebar(page).getByRole("button", { name: /^Back \(/ });
const forward = (page: Page) => titlebar(page).getByRole("button", { name: /^Forward \(/ });
const studyPanel = (page: Page) => page.getByRole("complementary", { name: "Repertoire study" });
const hubList = (page: Page) => page.getByRole("list", { name: "Repertoires" });

async function expectBoard(page: Page, players: RegExp) {
  await expect(page.getByRole("region", { name: "Board" })).toBeVisible();
  await expect(titlebar(page)).toContainText(players);
}

async function openStudy(page: Page) {
  await sidebar(page).getByRole("button", { name: "Repertoire", exact: true }).click();
  await hubList(page)
    .getByRole("button", { name: `Study ${REPERTOIRE}`, exact: true })
    .click();
  await expect(studyPanel(page)).toBeVisible();
}

const ALPHA = /Alpha\s*vs\s*Beta/;
const GAMMA = /Gamma\s*vs\s*Delta/;

test("Back and Forward walk library → game → repertoire study and back", async ({
  launch,
  profile
}) => {
  const { app, page } = await launch();
  await skipWelcome(page);
  await seedRepertoire(page);
  await importPgnFile(app, page, writePgn(profile, "ruy-lopez.pgn", RUY_LOPEZ_PGN));
  await expectBoard(page, ALPHA);
  await importPgnFile(app, page, writePgn(profile, "sicilian.pgn", SICILIAN_PGN));
  await expectBoard(page, GAMMA);

  // The library: the first game again, as a step of its own.
  await page.getByRole("tab", { name: "Library" }).click();
  await page
    .getByRole("list", { name: "Saved games" })
    .getByRole("button", { name: ALPHA })
    .click();
  await expectBoard(page, ALPHA);
  await openStudy(page);

  await back(page).click();
  await expect(hubList(page)).toBeVisible();
  await back(page).click();
  await expectBoard(page, ALPHA);
  // The game the library was opened from comes back on its Library tab.
  await back(page).click();
  await expectBoard(page, GAMMA);
  await expect(page.getByRole("tab", { name: "Library" })).toHaveAttribute("aria-selected", "true");

  await forward(page).click();
  await expectBoard(page, ALPHA);
  await forward(page).click();
  await expect(hubList(page)).toBeVisible();
  await forward(page).click();
  await expect(studyPanel(page)).toBeVisible();
  await expect(forward(page)).toBeDisabled();
});

test("Back to a deleted chapter or game says why and lands somewhere that exists", async ({
  launch,
  profile
}) => {
  const { app, page } = await launch();
  await skipWelcome(page);
  const repertoire = await seedRepertoire(page);
  await importPgnFile(app, page, writePgn(profile, "ruy-lopez.pgn", RUY_LOPEZ_PGN));
  await expectBoard(page, ALPHA);
  await importPgnFile(app, page, writePgn(profile, "sicilian.pgn", SICILIAN_PGN));
  await expectBoard(page, GAMMA);
  await openStudy(page);
  await sidebar(page).getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();

  // Both go while you're away: the repertoire and the first game.
  await page.evaluate(async (repertoireId) => {
    const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga;
    const detail = await api.repertoires.get(repertoireId);
    await api.repertoires.remove({ id: repertoireId, expectedRevision: detail.revision });
    const { items } = await api.games.listPage({ search: "Alpha" });
    for (const game of items) await api.games.remove(game.id);
  }, repertoire.id);

  // The study page finds its repertoire gone and hands over to the hub, saying so.
  await back(page).click();
  await expect(page.getByRole("main")).toContainText(
    /That (repertoire|chapter) no longer exists\.|That chapter couldn't be opened\./
  );
  await expect(page.getByText("No repertoires yet")).toBeVisible();
  await expect(studyPanel(page)).toHaveCount(0);

  // The hub the study was opened from (now empty), then the second game.
  await back(page).click();
  await expect(page.getByText("No repertoires yet")).toBeVisible();
  await back(page).click();
  await expectBoard(page, GAMMA);
  // The deleted game: you stay on this board, told why, and its step is gone.
  await back(page).click();
  await expect(page.getByRole("main")).toContainText("That game was deleted.");
  await expectBoard(page, GAMMA);
  await back(page).click();
  await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible();
  await expect(back(page)).toBeDisabled();
});

test("Back from a chapter whose edits can't be saved stays on it", async ({ launch }) => {
  const { app, page } = await launch();
  await skipWelcome(page);
  await seedRepertoire(page);
  await openStudy(page);
  await page.getByRole("tab", { name: "Chapters", exact: true }).click();
  const list = page.getByRole("list", { name: "Chapters" });
  const chapter = (title: string) =>
    list.getByRole("button", { name: new RegExp(`^${title} \\d+ moves?`) });
  // Two chapter steps, so Back's target is another chapter whatever the hub opened.
  await chapter("Italian").click();
  await expect(chapter("Italian")).toHaveAttribute("aria-current", "true");
  await chapter("Scotch").click();
  await expect(chapter("Scotch")).toHaveAttribute("aria-current", "true");

  // Every save of the chapter now fails; a new move (1.d4) makes an edit to save.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("repertoires:saveChapter");
    ipcMain.handle("repertoires:saveChapter", () => {
      throw new Error("E2E simulated chapter write failure");
    });
  });
  await clickSquare(page, "d2");
  await clickSquare(page, "d4");
  await expect(studyPanel(page)).toContainText("E2E simulated chapter write failure");

  await back(page).click();
  await expect(page.getByRole("main")).toContainText(
    "This chapter couldn't be saved; retry the save before opening another one."
  );
  await expect(chapter("Scotch")).toHaveAttribute("aria-current", "true");
  await expect(forward(page)).toBeDisabled();

  // The edits still can't be saved: closing asks, and the run answers "Close Anyway".
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync;
  });
});
