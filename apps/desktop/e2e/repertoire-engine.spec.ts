// Study's engine panel (Analyze) through the built app, on the fake UCI engine in its "lines" mode
// (two lines that fit each position of the seeded chapter); how to run them: playwright.config.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import type { ChaturangaApi } from "../../../packages/shared/src/ipc/chaturanga-api";
import { expect, registerFakeEngine, sidebar, skipWelcome, test } from "./app";

const REPERTOIRE = "Engine repertoire e2e";

/** Where the journey's screenshot of the open panel goes (unset: none is taken). */
const SCREENSHOT = process.env.CHATURANGA_E2E_ENGINE_PANEL_SCREENSHOT;

/** A White repertoire whose chapter is 1. e4 e5 2. Nf3 Nc6 3. Bc4, opened by "Study" at its start. */
function seedRepertoire(page: Page) {
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

const studyPanel = (page: Page) => page.getByRole("complementary", { name: "Repertoire study" });
const enginePanel = (page: Page) => studyPanel(page).getByRole("region", { name: "Engine analysis" });
const chapterMoves = (page: Page) => page.getByRole("tree", { name: "Chapter moves" });
const addLine = (page: Page, san: string) =>
  enginePanel(page).getByRole("button", { name: `Add the line to ${san} to the chapter`, exact: true });

/** The UCI commands the fake engine received, in order. */
function engineCommands(log: string): string[] {
  try {
    return readFileSync(log, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

test("Analyze runs the engine in study: its lines follow the selection, a picked move joins the chapter and Undo takes it back", async ({
  launch,
  profile
}) => {
  const log = join(profile, "fake-engine.log");
  const { page } = await launch();
  await skipWelcome(page);
  await registerFakeEngine(page, log, "lines");
  await seedRepertoire(page);
  await sidebar(page).getByRole("button", { name: "Repertoire", exact: true }).click();
  await page.getByRole("button", { name: `Study ${REPERTOIRE}`, exact: true }).click();
  await page.getByRole("tab", { name: "Moves", exact: true }).click();
  await expect(chapterMoves(page)).toBeVisible();
  const board = page.getByRole("region", { name: "Board" }).locator("cg-board");
  const boardBox = await board.boundingBox();

  // Analyze opens the panel in place (no other screen) with the start position's lines and the bar.
  const analyze = studyPanel(page).getByRole("button", { name: "Analyze", exact: true });
  await expect(analyze).toHaveAttribute("aria-expanded", "false");
  await analyze.click();
  await expect(analyze).toHaveAttribute("aria-expanded", "true");
  await expect(enginePanel(page)).toBeVisible();
  await expect(enginePanel(page).getByRole("heading", { name: "Fake UCI" })).toBeVisible({
    timeout: 15_000
  });
  await expect(addLine(page, "e4")).toBeVisible();
  await expect(addLine(page, "d4")).toBeVisible();
  await expect(page.getByRole("img", { name: /^Evaluation / })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Moves", exact: true })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  // The board keeps its size with the panel and bar open.
  expect(await board.boundingBox()).toEqual(boardBox);
  // The engine searched the chapter's position (from its root, with its moves).
  expect(engineCommands(log)).toContain(
    "position fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
  );

  // Selecting another move searches that one: the lines follow.
  await chapterMoves(page).getByRole("button", { name: "Bc4", exact: true }).click();
  await expect(addLine(page, "Nf6")).toBeVisible();
  await expect(addLine(page, "Bc5")).toBeVisible();
  await expect(addLine(page, "e4")).toHaveCount(0);
  expect(engineCommands(log).at(-2)).toBe(
    "position fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1 moves e2e4 e7e5 g1f3 b8c6 f1c4"
  );

  // An unfolded line's move shows its position below the lines, without the line repeated there.
  await enginePanel(page).getByRole("button", { name: "Show the whole line" }).first().click();
  await addLine(page, "d3").first().hover();
  const preview = enginePanel(page).getByRole("group", { name: /^Position after / });
  await expect(preview).toBeVisible();
  await expect(preview.locator("cg-board")).toBeVisible();
  await expect(preview).toContainText("Line score");
  await expect(preview).not.toContainText("Nf6");
  await expect(preview).not.toContainText("d3");
  if (SCREENSHOT) await page.screenshot({ path: SCREENSHOT });

  // Picking an engine move adds it to the chapter at the selected move and selects it.
  await chapterMoves(page).hover();
  await addLine(page, "Nf6").click();
  await expect(chapterMoves(page).getByRole("button", { name: "Nf6", exact: true })).toBeVisible();
  // The board shows the new move (its route under the board).
  await expect(
    page.getByRole("region", { name: "Board" }).getByText("1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6", { exact: true })
  ).toBeVisible();
  await expect(addLine(page, "d3")).toBeVisible();
  await expect(page.getByRole("banner", { name: "Titlebar" })).toContainText("Saved");

  // Undo takes it back (one step), and the lines are the previous move's again.
  await studyPanel(page).getByRole("button", { name: "Undo", exact: true }).click();
  await expect(chapterMoves(page).getByRole("button", { name: "Nf6", exact: true })).toHaveCount(0);
  await expect(addLine(page, "Nf6")).toBeVisible();
  await expect(page.getByRole("banner", { name: "Titlebar" })).toContainText("Saved");

  // Closing the panel stops the engine; the bar goes with it.
  await enginePanel(page).getByRole("button", { name: "Close the engine" }).click();
  await expect(enginePanel(page)).toHaveCount(0);
  await expect(analyze).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("img", { name: /^Evaluation / })).toHaveCount(0);
  await expect.poll(() => engineCommands(log).at(-1)).toBe("stop");
  expect(await board.boundingBox()).toEqual(boardBox);
});

test("leaving Study stops the engine panel's search", async ({ launch, profile }) => {
  const log = join(profile, "fake-engine.log");
  const { page } = await launch();
  await skipWelcome(page);
  await registerFakeEngine(page, log, "lines");
  await seedRepertoire(page);
  await sidebar(page).getByRole("button", { name: "Repertoire", exact: true }).click();
  await page.getByRole("button", { name: `Study ${REPERTOIRE}`, exact: true }).click();
  await studyPanel(page).getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(addLine(page, "e4")).toBeVisible({ timeout: 15_000 });

  await page
    .getByRole("navigation", { name: "Repertoire location" })
    .getByRole("button", { name: "Repertoire", exact: true })
    .click();
  await expect(page.getByRole("button", { name: `Study ${REPERTOIRE}`, exact: true })).toBeVisible();
  await expect.poll(() => engineCommands(log).at(-1)).toBe("stop");

  // Back in Study the panel starts closed.
  await page.getByRole("button", { name: `Study ${REPERTOIRE}`, exact: true }).click();
  await expect(
    studyPanel(page).getByRole("button", { name: "Analyze", exact: true })
  ).toHaveAttribute("aria-expanded", "false");
  await expect(enginePanel(page)).toHaveCount(0);
});
