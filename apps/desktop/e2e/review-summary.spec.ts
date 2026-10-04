// The review summary through the built app: an imported game asks which side to review it as,
// the summary's scoreboard, opening, phases and practice chips (each section folds, and stays
// folded), the opening and theme shortcuts into Puzzles, the review settings dialog switching
// sides, and key-moment cards that neither expand nor show commentary with AI commentary off.
// A short game reviewed on the fake UCI engine's "review" mode (the Blackburne Shilling trap, as
// in move-types.spec.ts). How to run them: playwright.config.ts.
import type { Page } from "@playwright/test";
import {
  expect,
  importPgnFile,
  registerFakeEngine,
  routeToFile,
  sidebar,
  skipWelcome,
  test
} from "./app";
import { join } from "node:path";
import { LICHESS_PUZZLES_URL, writeLichessPuzzleFile, writePgn } from "./fixtures";

const TRAP_PGN = `[Event "Review summary e2e"]
[White "Alpha"]
[Black "Beta"]
[Result "0-1"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3# 0-1
`;

const titlebar = (page: Page) => page.getByRole("banner", { name: "Titlebar" });
const reviewTabs = (page: Page) => page.getByRole("tablist", { name: "Game review sections" });
const summary = (page: Page) => page.getByRole("region", { name: "Review summary" });
const markRow = (page: Page, mark: string) =>
  summary(page).getByRole("table", { name: "Marks" }).getByRole("row").filter({ hasText: mark });

/** Imports the trap game, opens its review and analyses it as `side` (picked in the prompt). */
async function reviewTrapGameAs(
  page: Page,
  app: Parameters<typeof importPgnFile>[0],
  profile: string,
  side: "White (Alpha)" | "Black (Beta)"
) {
  await registerFakeEngine(page, join(profile, "uci.log"), "review");
  await importPgnFile(app, page, writePgn(profile, "trap.pgn", TRAP_PGN));
  await expect(page.getByRole("region", { name: "Board" })).toBeVisible();
  await sidebar(page).getByRole("button", { name: "Game review", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Choose a game" })
    .getByRole("button", { name: /^Alpha vs Beta/ })
    .click();
  await expect(reviewTabs(page)).toBeVisible();

  // An imported game asks before its review starts; nothing names the Lichess account here, so
  // the Settings side (White) is preselected.
  const prompt = page.getByRole("radiogroup", { name: "Review this game as" });
  await expect(prompt).toBeVisible();
  await expect(prompt.getByRole("radio", { name: "White (Alpha)" })).toHaveAttribute(
    "aria-checked",
    "true"
  );
  // The titlebar's Analyze asks too, instead of starting.
  await titlebar(page).getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(prompt).toBeVisible();
  await prompt.getByRole("radio", { name: side }).click();
  await page.getByRole("button", { name: "Start review", exact: true }).click();
  await expect(
    titlebar(page).getByRole("button", { name: "Analyze again", exact: true })
  ).toBeVisible({ timeout: 60_000 });
}

test("the summary scores both sides, names the opening and phases, and its sections fold", async ({
  launch,
  profile
}) => {
  test.setTimeout(120_000);
  const { app, page } = await launch();
  await skipWelcome(page);
  await reviewTrapGameAs(page, app, profile, "White (Alpha)");

  // The first screen after the review: the summary, the board turned to White.
  await expect(reviewTabs(page).getByRole("tab", { name: "Summary" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await expect(page.getByText("Review as White", { exact: true })).toBeVisible();
  await expect(summary(page).getByLabel(/^White accuracy \d+\.\d$/)).toBeVisible();
  await expect(summary(page).getByLabel(/^Black accuracy \d+\.\d$/)).toBeVisible();
  await expect(summary(page).getByRole("img", { name: "Accuracy" })).toBeVisible();

  // Only the marks the game has, best to worst, counted per side; no centipawns anywhere.
  const marks = summary(page).getByRole("table", { name: "Marks" }).getByRole("rowheader");
  await expect(marks).toHaveText(["Book", "Great", "Good", "Mistake", "Blunder"]);
  await expect(markRow(page, "Book").getByRole("cell", { name: "White 3" })).toBeVisible();
  await expect(markRow(page, "Book").getByRole("cell", { name: "Black 3" })).toBeVisible();
  await expect(markRow(page, "Blunder").getByRole("cell", { name: "White 2" })).toBeVisible();
  await expect(markRow(page, "Great").getByRole("cell", { name: "Black 1" })).toBeVisible();
  await expect(summary(page)).not.toContainText("cp");

  // The opening: where the book ended and the move that left it.
  await expect(summary(page)).toContainText("Book until move 3 · left theory with 4. Nxe5");
  await expect(summary(page).getByRole("button", { name: "My repertoire" })).toBeVisible();

  // Phases: the opening (the book) and the middlegame; the game never reached an endgame.
  const phases = summary(page).getByRole("table", { name: "Accuracy by phase" });
  await expect(phases.getByRole("rowheader")).toHaveText(["Opening", "Middlegame"]);

  // Practice: the themes behind White's errors, Be2's mate in one among them.
  const practice = summary(page).getByRole("group", { name: "Practise your mistakes" });
  await expect(practice.getByRole("button", { name: /^Mate in 1/ })).toBeVisible();

  // Each section folds behind its header (⌄ Phases), and stays folded when the summary is shown
  // again. Folding Accuracy hides the mark rows; its boxes stay on the header row.
  const phasesToggle = summary(page).getByRole("button", { name: "Phases" });
  await expect(phasesToggle).toHaveAttribute("aria-expanded", "true");
  await phasesToggle.click();
  await expect(phasesToggle).toHaveAttribute("aria-expanded", "false");
  await expect(phases).toHaveCount(0);
  const accuracyToggle = summary(page).getByRole("button", { name: "Accuracy", exact: true });
  await accuracyToggle.click();
  await expect(accuracyToggle).toHaveAttribute("aria-expanded", "false");
  await expect(summary(page).getByRole("table", { name: "Marks" })).toHaveCount(0);
  await expect(summary(page).getByLabel(/^White accuracy/)).toBeVisible();
  await reviewTabs(page).getByRole("tab", { name: "Commentary", exact: true }).click();
  await reviewTabs(page).getByRole("tab", { name: "Summary", exact: true }).click();
  await expect(summary(page).getByRole("button", { name: "Phases" })).toHaveAttribute(
    "aria-expanded",
    "false"
  );
  await expect(summary(page).getByRole("table", { name: "Accuracy by phase" })).toHaveCount(0);
  await summary(page).getByRole("button", { name: "Phases" }).click();
  await summary(page).getByRole("button", { name: "Accuracy", exact: true }).click();
  await expect(summary(page).getByRole("table", { name: "Accuracy by phase" })).toBeVisible();

  // Start review: the first of White's key moments, explained in the Commentary tab.
  await summary(page).getByRole("button", { name: "Start review", exact: true }).click();
  await expect(reviewTabs(page).getByRole("tab", { name: "Commentary" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await expect(page.getByRole("heading", { name: "4. Nxe5", level: 2 })).toBeVisible();
});

test("the summary's opening and practice shortcuts open Puzzles with that filter", async ({
  launch,
  profile
}) => {
  test.setTimeout(120_000);
  const { app, page } = await launch();
  // A Lichess puzzle database whose puzzles are all tagged Italian_Game (mate in one).
  await routeToFile(app, LICHESS_PUZZLES_URL, writeLichessPuzzleFile(profile));
  await skipWelcome(page);
  await sidebar(page).getByRole("button", { name: "Databases", exact: true }).click();
  const lichess = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "Lichess Puzzle Database" }) });
  await lichess.getByRole("button", { name: "Download", exact: true }).click();
  await expect(lichess.getByRole("button", { name: "Train with this dataset" })).toBeVisible({
    timeout: 30_000
  });
  await reviewTrapGameAs(page, app, profile, "White (Alpha)");

  // Opening puzzles: the game's variation has none here, so its family, Italian Game.
  await summary(page).getByRole("button", { name: "Opening puzzles" }).click();
  await expect(page.getByRole("heading", { name: "Puzzles", level: 1 })).toBeVisible({
    timeout: 30_000
  });
  await page.getByRole("button", { name: "Openings" }).click();
  await expect(page.getByRole("button", { name: "Remove Italian Game" })).toBeVisible();

  // Back to the review: a practice chip opens Puzzles with its theme.
  await sidebar(page).getByRole("button", { name: "Game review", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Choose a game" });
  await expect(reviewTabs(page).or(picker)).toBeVisible();
  if (await picker.isVisible())
    await picker.getByRole("button", { name: /^Alpha vs Beta/ }).click();
  await reviewTabs(page).getByRole("tab", { name: "Summary", exact: true }).click();
  await summary(page)
    .getByRole("group", { name: "Practise your mistakes" })
    .getByRole("button", { name: /^Mate in 1/ })
    .click();
  await expect(page.getByRole("heading", { name: "Puzzles", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove mate in 1" })).toBeVisible();
  // The opening filter was cleared for it.
  await page.getByRole("button", { name: "Openings" }).click();
  await expect(page.getByRole("button", { name: "Remove Italian Game" })).toHaveCount(0);
});

test("review settings are a dialog that switches sides; with AI off, cards don't expand", async ({
  launch,
  profile
}) => {
  test.setTimeout(120_000);
  const { app, page } = await launch();
  await skipWelcome(page);
  await reviewTrapGameAs(page, app, profile, "White (Alpha)");

  // No Settings tab: a sliders button in the panel's header opens the settings as a dialog.
  await expect(reviewTabs(page).getByRole("tab", { name: "Settings", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Review settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Review settings" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "AI settings" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Edit ratings" })).toBeVisible();
  // Its groups fold too.
  await expect(dialog.getByRole("button", { name: "Engine" })).toHaveAttribute(
    "aria-expanded",
    "true"
  );

  // Review as Black: the board turns, and the key moments are Black's (Qg5 and Qxg2).
  await dialog
    .getByRole("radiogroup", { name: "Review as" })
    .getByRole("radio", { name: /^Black/ })
    .click();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Review as Black", { exact: true })).toBeVisible();
  await reviewTabs(page).getByRole("tab", { name: "Commentary", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Move navigation" })
    .getByRole("button", { name: "First move", exact: true })
    .click();
  const cards = page.getByRole("list", { name: "Key moments of the game" });
  await expect(cards.getByRole("listitem")).toHaveCount(2);
  await expect(cards.getByRole("listitem").nth(0)).toContainText("4… Qg5");
  await expect(cards.getByRole("listitem").nth(1)).toContainText("5… Qxg2");

  // AI commentary is off in this profile (no OpenRouter key): the cards neither expand nor show
  // commentary, and never say what an error cost.
  const card = cards.getByRole("button").first();
  await expect(card).not.toHaveAttribute("aria-expanded", /.*/);
  await expect(cards.getByRole("region", { name: "Commentary" })).toHaveCount(0);
  await expect(cards).not.toContainText("of the winning chances");
});
