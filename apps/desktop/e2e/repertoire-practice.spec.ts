// Repertoire practice journeys: reading an answer's notes, moving on with Next, and the summary's
// review queue of missed positions. How to run them: playwright.config.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";
import type { ChaturangaApi } from "../../../packages/shared/src/ipc/chaturanga-api";
import { clickSquare, expect, sidebar, skipWelcome, test } from "./app";

/**
 * A White repertoire with an opening chapter "Italian": 1. e4 e5 2. Nf3 Nc6 3. Bc4, so three
 * decisions (the start, after 1... e5, after 2... Nc6). e4 and Nf3 carry comments, and so does
 * 1... e5 (the explanation of the position after it). Set up through the preload bridge.
 */
function seedRepertoire(page: Page) {
  return page.evaluate(async () => {
    const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga.repertoires;
    const created = await api.create({ name: "White practice", color: "white" });
    const preview = await api.previewImport({
      pgn: '[Event "Italian"]\n\n1. e4 {Control the centre} e5 {Black mirrors} 2. Nf3 {Develop with tempo} Nc6 3. Bc4 *'
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
    // Study opens on the imported chapter (the repertoire's first chapter is empty).
    const chapter = imported.repertoire.chapters.find((item) => item.title === "Italian")!;
    await api.saveWorkspace({
      repertoireId: created.id,
      workspace: {
        lastChapterId: chapter.id,
        lastNodeId: "root",
        orientation: "white",
        practiceDraft: null
      }
    });
  });
}

const practicePanel = (page: Page) => page.getByRole("complementary", { name: "Practice" });

/**
 * The repertoire's stored practice progress (stage, due date, lapses, successes per decision),
 * read from a backup with progress written into the throwaway profile.
 */
async function storedProgress(app: ElectronApplication, page: Page, profile: string) {
  const file = join(profile, `progress-${Date.now()}.json`);
  await app.evaluate(({ dialog }, file) => {
    const previous = dialog.showSaveDialog;
    dialog.showSaveDialog = (async () => {
      dialog.showSaveDialog = previous;
      return { canceled: false, filePath: file };
    }) as typeof dialog.showSaveDialog;
  }, file);
  await page.evaluate(async () => {
    const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga.repertoires;
    const [repertoire] = await api.list({});
    await api.exportBackup({ repertoireIds: [repertoire.id], includeProgress: true });
  });
  const document = JSON.parse(readFileSync(file, "utf8")) as {
    repertoires: { progress: unknown[] }[];
  };
  return document.repertoires[0].progress;
}

/** Opens the repertoire's chapter in Study, then its practice setup. */
async function openPracticeSetup(page: Page) {
  await sidebar(page).getByRole("button", { name: "Repertoire", exact: true }).click();
  await page.getByRole("button", { name: "Study White practice", exact: true }).click();
  await page.getByRole("button", { name: "Practice this chapter", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start review", exact: true })).toBeVisible();
}

test("practice shows an answer's notes only after grading, waits for Next, and retries the misses", async ({
  launch,
  profile
}) => {
  const { app, page } = await launch();
  await skipWelcome(page);
  await seedRepertoire(page);
  await openPracticeSetup(page);

  await page.getByRole("radio", { name: "Learn new", exact: true }).click();
  await page.getByLabel("Next card").selectOption({ label: "When I press Next" });
  await page.getByRole("button", { name: "Start learning", exact: true }).click();
  const panel = practicePanel(page);
  await expect(panel).toContainText("1 of 3");

  // Before grading: no answer, no comment of an answer move.
  await expect(panel.getByText("Control the centre")).toHaveCount(0);
  await expect(panel.getByText("You played", { exact: false })).toHaveCount(0);

  // A correct answer: the move, its comment, and the card stays until Next.
  await clickSquare(page, "e2");
  await clickSquare(page, "e4");
  await expect(panel.getByText("You played e4.")).toBeVisible();
  await expect(panel.getByText("Control the centre", { exact: false })).toBeVisible();
  await page.waitForTimeout(1_500);
  await expect(panel).toContainText("1 of 3");
  // Space is Next (focus is on the board, not on a button).
  await page.keyboard.press("Space");
  await expect(panel).toContainText("2 of 3");

  // A wrong answer keeps the answer, its comment and the position's explanation hidden...
  await expect(panel.getByText("Black mirrors")).toHaveCount(0);
  await clickSquare(page, "d2");
  await clickSquare(page, "d4");
  await expect(panel.getByText("This move is outside your repertoire.")).toBeVisible();
  await expect(panel.getByText("Develop with tempo", { exact: false })).toHaveCount(0);
  await expect(panel.getByText("Black mirrors")).toHaveCount(0);
  // ...until the answer is revealed.
  await panel.getByRole("button", { name: "Reveal", exact: true }).click();
  await expect(panel.getByText("Preferred: Nf3")).toBeVisible();
  await expect(panel.getByText("Black mirrors")).toBeVisible();
  await expect(panel.getByText("Develop with tempo", { exact: false })).toBeVisible();
  await page.locator("body").press("Enter");
  await expect(panel).toContainText("3 of 3");

  // A second miss, then the summary.
  await clickSquare(page, "d2");
  await clickSquare(page, "d4");
  await expect(panel.getByText("This move is outside your repertoire.")).toBeVisible();
  await panel.getByRole("button", { name: "See summary", exact: true }).click();

  // The summary lists every miss with its chapter and moves, each with a Study link.
  await expect(page.getByRole("heading", { name: "Session complete" })).toBeVisible();
  const missed = page.getByRole("list", { name: "Missed positions" });
  await expect(missed.getByRole("listitem")).toHaveCount(2);
  await expect(missed.getByRole("listitem").nth(0)).toContainText("Italian");
  await expect(missed.getByRole("listitem").nth(0)).toContainText("1. e4 e5");
  await expect(missed.getByRole("listitem").nth(1)).toContainText("1. e4 e5 2. Nf3 Nc6");
  await expect(
    missed.getByRole("button", { name: "Study Italian: 1. e4 e5 2. Nf3 Nc6", exact: true })
  ).toBeVisible();

  await expect(page.getByText("the retry changes no schedule", { exact: false })).toBeVisible();
  const missedProgress = await storedProgress(app, page, profile);
  expect(missedProgress).toHaveLength(3);

  // Retry missed: a targeted session of the two misses, labelled as extra practice that isn't
  // scheduled. Correct answers seconds after the misses leave their relearn steps as they were.
  await page.getByRole("button", { name: "Retry missed", exact: true }).click();
  await expect(panel).toContainText("1 of 2");
  await expect(page.getByText("Extra practice, not scheduled · ", { exact: false })).toBeVisible();
  await clickSquare(page, "g1");
  await clickSquare(page, "f3");
  await expect(panel.getByText("You played Nf3.")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(panel).toContainText("2 of 2");
  await clickSquare(page, "f1");
  await clickSquare(page, "c4");
  await expect(panel.getByText("You played Bc4.")).toBeVisible();
  await panel.getByRole("button", { name: "See summary", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Extra practice complete" })).toBeVisible();
  await expect(page.getByText("nothing was scheduled", { exact: false })).toBeVisible();
  expect(await storedProgress(app, page, profile)).toEqual(missedProgress);
});

test("a missed position's Study link opens it in its chapter", async ({ launch }) => {
  const { page } = await launch();
  await skipWelcome(page);
  await seedRepertoire(page);
  await openPracticeSetup(page);
  await page.getByRole("radio", { name: "Learn new", exact: true }).click();
  await page.getByRole("button", { name: "Start learning", exact: true }).click();
  const panel = practicePanel(page);
  await expect(panel).toContainText("1 of 3");
  await panel.getByRole("button", { name: "Reveal", exact: true }).click();
  await panel.getByRole("button", { name: "End session", exact: true }).click();

  const missed = page.getByRole("list", { name: "Missed positions" });
  await expect(missed.getByRole("listitem")).toHaveCount(1);
  await missed.getByRole("button", { name: "Study Italian: Start", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Repertoire study" })).toBeVisible();
});
