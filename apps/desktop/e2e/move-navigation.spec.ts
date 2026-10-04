// Move navigation rows (First / Previous · "n / N" · Next / Last) on the game board and the
// repertoire study board: what each button does, that the row's controls share one line, and that
// moves are played on the board only (no typed-move field or button). How to run them:
// playwright.config.ts.
import type { Locator, Page } from "@playwright/test";
import type { ChaturangaApi } from "../../../packages/shared/src/ipc/chaturanga-api";
import { expect, importPgnFile, sidebar, skipWelcome, test } from "./app";
import { RUY_LOPEZ_PGN, writePgn } from "./fixtures";

const REPERTOIRE = "Navigation row repertoire";

/** A White repertoire with one chapter of 1. e4 e5 2. Nf3 Nc6 3. Bc4, which "Study" opens at its start. */
function seedRepertoire(page: Page): Promise<void> {
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
  }, REPERTOIRE);
}

const navigation = (page: Page) => page.getByRole("navigation", { name: "Move navigation" });
const counter = (page: Page) => navigation(page).getByRole("paragraph").first();
const navButton = (page: Page, name: string) =>
  navigation(page).getByRole("button", { name, exact: true });

/** Clicks each navigation button and checks the counter and which buttons are enabled. */
async function walkTheRow(page: Page, total: number) {
  if (await navButton(page, "Last move").isEnabled()) await navButton(page, "Last move").click();
  await expect(counter(page)).toHaveText(`${total} / ${total}`);
  await expect(navButton(page, "Next move")).toBeDisabled();
  await expect(navButton(page, "Last move")).toBeDisabled();
  await navButton(page, "Previous move").click();
  await expect(counter(page)).toHaveText(`${total - 1} / ${total}`);
  await navButton(page, "First move").click();
  await expect(counter(page)).toHaveText(`0 / ${total}`);
  await expect(navButton(page, "First move")).toBeDisabled();
  await expect(navButton(page, "Previous move")).toBeDisabled();
  await navButton(page, "Next move").click();
  await expect(counter(page)).toHaveText(`1 / ${total}`);
  await expect(navButton(page, "First move")).toBeEnabled();
  await expect(navButton(page, "Last move")).toBeEnabled();
}

/** The four buttons and the counter sit on one line, the counter between the two button pairs. */
async function expectOneLine(page: Page) {
  const boxes = await Promise.all(
    ["First move", "Previous move", "Next move", "Last move"].map((name) =>
      boxOf(navButton(page, name))
    )
  );
  const middle = await boxOf(counter(page));
  const centre = (box: Box) => box.y + box.height / 2;
  for (const box of [...boxes, middle])
    expect(Math.abs(centre(box) - centre(boxes[0]))).toBeLessThan(2);
  expect(middle.x).toBeGreaterThan(boxes[1].x + boxes[1].width);
  expect(middle.x + middle.width).toBeLessThan(boxes[2].x);
  // Nothing trails the Last button.
  await expect(navigation(page).getByRole("button")).toHaveCount(4);
}

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  return box;
}

/** Neither a slash nor a move letter opens a typed-move field, and there is no button for one. */
async function expectNoTypedMoves(page: Page, board: Locator) {
  await board.click({ position: { x: 3, y: 3 } });
  for (const key of ["/", "N", "e"]) await page.keyboard.press(key);
  await expect(page.getByRole("textbox", { name: "Type a move" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Type a move/ })).toHaveCount(0);
}

test("the game board's navigation row steps through a game on one line, with no typed moves", async ({
  launch,
  profile
}) => {
  const { app, page } = await launch();
  await skipWelcome(page);
  await importPgnFile(app, page, writePgn(profile, "ruy-lopez.pgn", RUY_LOPEZ_PGN));
  await expect(counter(page)).toHaveText("6 / 6");

  await walkTheRow(page, 6);
  await expectOneLine(page);
  await expectNoTypedMoves(page, page.getByRole("region", { name: "Board" }));
  await expect(counter(page)).toHaveText("1 / 6");
});

test("the repertoire study row steps through a chapter on one line, with no typed moves", async ({
  launch
}) => {
  const { page } = await launch();
  await skipWelcome(page);
  await seedRepertoire(page);
  await sidebar(page).getByRole("button", { name: "Repertoire", exact: true }).click();
  await page.getByRole("button", { name: `Study ${REPERTOIRE}`, exact: true }).click();
  await expect(counter(page)).toHaveText("0 / 5");

  await walkTheRow(page, 5);
  await expectOneLine(page);
  await expectNoTypedMoves(page, page.locator("cg-board").first());
  await expect(counter(page)).toHaveText("1 / 5");

  // Practice's footer ends the session and offers nothing for typing a move.
  const study = page.getByRole("complementary", { name: "Repertoire study" });
  await study.getByRole("button", { name: "Practice this chapter", exact: true }).click();
  await page.getByRole("radio", { name: "Learn new", exact: true }).click();
  await page.getByRole("button", { name: "Start learning", exact: true }).click();
  await expect(page.getByText("Play your move on the board")).toBeVisible();
  await expect(page.getByRole("button", { name: "End session", exact: true })).toBeVisible();
  await expectNoTypedMoves(page, page.locator("cg-board").first());
});
