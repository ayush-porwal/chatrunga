// The move list through the built app: a short game reviewed on the fake UCI engine in its
// "review" mode (scripted lines for the Blackburne Shilling trap, see the script). Every move shows
// its piece, the book moves end in the opening's row, and each marked error's BEST line folds under
// it: its moves preview their position on hover (the game's own moves don't), and clicking one
// browses the line on the board without adding it to the game; only a new move played from it does.
// How to run them: playwright.config.ts.
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  clickSquare,
  expect,
  importPgnFile,
  registerFakeEngine,
  sidebar,
  skipWelcome,
  test
} from "./app";
import { writePgn } from "./fixtures";

const TRAP_PGN = `[Event "Move list e2e"]
[White "Alpha"]
[Black "Beta"]
[Result "0-1"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3# 0-1
`;

const reviewTabs = (page: Page) => page.getByRole("tablist", { name: "Game review sections" });
const moveTree = (page: Page) => page.getByRole("tree", { name: "Reviewed move tree" });
const bestLines = (page: Page) => moveTree(page).getByRole("group", { name: /^Best line: / });
const previews = (page: Page) => moveTree(page).locator("[data-line-preview]");
const counter = (page: Page) =>
  page.getByRole("navigation", { name: "Move navigation" }).getByRole("paragraph").first();

test("BEST lines fold under their errors, preview on hover and are browsed on the board, not added to the game", async ({
  launch,
  profile
}) => {
  test.setTimeout(120_000);
  const { app, page } = await launch();
  await skipWelcome(page);
  await registerFakeEngine(page, join(profile, "uci.log"), "review");
  await importPgnFile(app, page, writePgn(profile, "trap.pgn", TRAP_PGN));
  await expect(page.getByRole("region", { name: "Board" })).toBeVisible();
  await sidebar(page).getByRole("button", { name: "Game review", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Choose a game" })
    .getByRole("button", { name: /^Alpha vs Beta/ })
    .click();
  const titlebar = page.getByRole("banner", { name: "Titlebar" });
  await titlebar.getByRole("button", { name: "Analyze", exact: true }).click();
  // An imported game asks which side it's reviewed as: White.
  await page
    .getByRole("radiogroup", { name: "Review this game as" })
    .getByRole("radio", { name: "White (Alpha)" })
    .click();
  await page.getByRole("button", { name: "Start review", exact: true }).click();
  await expect(titlebar.getByRole("button", { name: "Analyze again", exact: true })).toBeVisible({
    timeout: 60_000
  });
  await reviewTabs(page).getByRole("tab", { name: "Moves", exact: true }).click();
  const tree = moveTree(page);
  await expect(tree).toBeVisible();

  // Every move shows its piece (a pawn for pawn moves), and is still named by its SAN.
  const knightTakes = tree.locator("[data-move-cell]").nth(6);
  await expect(knightTakes.getByRole("button", { name: "Nxe5", exact: true })).toHaveText(/^xe5/);
  await expect(knightTakes.locator("piece.white.knight")).toHaveCount(1);
  await expect(tree.locator("[data-move-cell]").nth(0).locator("piece.white.pawn")).toHaveCount(1);
  // The opening's row follows the last book move (3… Nd4).
  await expect(tree.getByText("book ends")).toBeVisible();
  await expect(tree.getByLabel(/Italian Game.*: book ends$/)).toBeVisible();

  // The lines start folded; an error's disc unfolds its own.
  await expect(bestLines(page)).toHaveCount(0);
  await tree.getByRole("button", { name: "Blunder: show the best line" }).first().click();
  await expect(bestLines(page)).toHaveCount(1);
  const line = tree.getByRole("group", { name: "Best line: 4. Nxd4 exd4" });
  await expect(line).toBeVisible();
  await expect(line).toContainText("Best");
  await expect(
    tree.getByRole("button", { name: "Blunder: hide the best line" }).first()
  ).toHaveAttribute("aria-expanded", "true");

  // Resting on a suggested move shows its position under the line; the game's moves have no preview.
  await tree.getByRole("button", { name: "Qg5", exact: true }).hover();
  await line.getByRole("button", { name: "Show 4. Nxd4 exd4 on the board" }).hover();
  await expect(previews(page)).toHaveCount(1);
  await expect(tree.getByRole("img", { name: "Position after 4… exd4" })).toBeVisible();
  await tree.getByRole("button", { name: "Qg5", exact: true }).hover();
  await expect(previews(page)).toHaveCount(0);

  // Clicking a suggested move shows it on the board and makes it the current move of the line;
  // the game's moves don't change (no variation is added) and no game move is current.
  const first = line.getByRole("button", { name: "Show 4. Nxd4 on the board" });
  const second = line.getByRole("button", { name: "Show 4. Nxd4 exd4 on the board" });
  await first.click();
  await expect(first).toHaveAttribute("aria-current", "step");
  await expect(tree.getByRole("treeitem")).toHaveCount(0);
  await expect(tree.locator('[data-tree-node-id][aria-current="step"]')).toHaveCount(0);
  // → steps along the line and stays on its last move; ← steps back, then before its first move
  // returns to the game move it branches from (3… Nd4).
  // (Two steps from the first move: the second one finds the line's end.)
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(second).toHaveAttribute("aria-current", "step");
  // The clicked move never took focus, so no focus ring stays on it while another move is current.
  await expect(first).not.toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(first).toHaveAttribute("aria-current", "step");
  await page.keyboard.press("ArrowLeft");
  await expect(counter(page)).toHaveText("6 / 14");
  await expect(tree.getByRole("button", { name: "Nd4", exact: true })).toHaveAttribute(
    "aria-current",
    "step"
  );
  await expect(line.locator('[aria-current="step"]')).toHaveCount(0);
  // Clicking a game move leaves the line for it.
  await second.click();
  await tree.getByRole("button", { name: "Nxf7", exact: true }).click();
  await expect(counter(page)).toHaveText("9 / 14");
  await expect(line.locator('[aria-current="step"]')).toHaveCount(0);
  await expect(tree.getByRole("treeitem")).toHaveCount(0);

  // The disc folds the line again.
  await tree.getByRole("button", { name: "Blunder: hide the best line" }).click();
  await expect(bestLines(page)).toHaveCount(0);

  // "Show all lines" unfolds every error's line (two blunders and a mistake), and is remembered.
  await tree.getByRole("button", { name: "Show all lines" }).click();
  await expect(bestLines(page)).toHaveCount(3);
  await reviewTabs(page).getByRole("tab", { name: "Commentary", exact: true }).click();
  await reviewTabs(page).getByRole("tab", { name: "Moves", exact: true }).click();
  await expect(bestLines(page)).toHaveCount(3);
  await tree.getByRole("button", { name: "Hide all lines" }).click();
  await expect(bestLines(page)).toHaveCount(0);

  // On the Analyze board, a new move played from a line's position makes the line up to it a real
  // variation: 4. Nxd4 exd4, then 5. d3.
  await sidebar(page).getByRole("button", { name: "Analyze", exact: true }).click();
  await page
    .getByRole("tablist", { name: "Workspace panels" })
    .getByRole("tab", { name: "Moves", exact: true })
    .click();
  const gameMoves = page.getByRole("tree", { name: "Game moves" });
  await gameMoves.getByRole("button", { name: "Blunder: show the best line" }).first().click();
  await gameMoves.getByRole("button", { name: "Show 4. Nxd4 exd4 on the board" }).click();
  await expect(gameMoves.getByRole("treeitem")).toHaveCount(0);
  await clickSquare(page, "d2");
  await clickSquare(page, "d3");
  await expect(gameMoves.getByRole("treeitem")).toHaveCount(3);
  await expect(gameMoves.getByRole("button", { name: "d3", exact: true })).toHaveAttribute(
    "aria-current",
    "step"
  );
});
