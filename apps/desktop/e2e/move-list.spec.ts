// The move list through the built app: a short game reviewed on the fake UCI engine in its
// "review" mode (scripted lines for the Blackburne Shilling trap, see the script). Every move shows
// its piece, the book moves end in the opening's row, and each marked error's BEST line folds under
// it: its moves preview their position on hover (the game's own moves don't), and clicking one
// browses the line on the board without adding it to the game; only a new move played from it does.
// The game's own variations are line rows too, under the move they were played instead of.
// How to run them: playwright.config.ts.
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import {
  clickSquare,
  expect,
  importPgnFile,
  registerFakeEngine,
  sidebar,
  skipWelcome,
  test
} from "./app";
import { RUY_LOPEZ_PGN, writePgn } from "./fixtures";

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
const variations = (tree: Locator) => tree.getByRole("group", { name: /^Variation: / });
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
  await expect(variations(tree)).toHaveCount(0);
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
  await expect(variations(tree)).toHaveCount(0);

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
  // variation: 4. Nxd4 exd4, then 5. d3. The BEST row stays, and the variation's row follows it.
  await sidebar(page).getByRole("button", { name: "Analyze", exact: true }).click();
  await page
    .getByRole("tablist", { name: "Workspace panels" })
    .getByRole("tab", { name: "Moves", exact: true })
    .click();
  const gameMoves = page.getByRole("tree", { name: "Game moves" });
  await gameMoves.getByRole("button", { name: "Blunder: show the best line" }).first().click();
  await gameMoves.getByRole("button", { name: "Show 4. Nxd4 exd4 on the board" }).click();
  await expect(variations(gameMoves)).toHaveCount(0);
  await clickSquare(page, "d2");
  await clickSquare(page, "d3");
  const played = gameMoves.getByRole("group", { name: "Variation: 4. Nxd4 exd4 5. d3" });
  await expect(played).toBeVisible();
  await expect(variations(gameMoves)).toHaveCount(1);
  await expect(played.getByRole("button", { name: "d3", exact: true })).toHaveAttribute(
    "aria-current",
    "step"
  );
  const bestRow = gameMoves.getByRole("group", { name: "Best line: 4. Nxd4 exd4" });
  await expect(bestRow).toBeVisible();
  expect(await top(played)).toBeGreaterThan(await top(bestRow));
});

/** A locator's box (it must be on screen). */
async function box(locator: Locator) {
  const found = await locator.boundingBox();
  if (!found) throw new Error("not on screen");
  return found;
}
const top = async (locator: Locator) => (await box(locator)).y;
const left = async (locator: Locator) => (await box(locator)).x;

// A long side line (the Giuoco Piano, 18 plies), instead of 3. Bb5.
const BRANCHED_PGN = `[Event "Variations e2e"]
[White "Alpha"]
[Black "Beta"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 (3. Bc4 Bc5 4. c3 Nf6 5. d4 exd4 6. cxd4 Bb4+ 7. Bd2 Bxd2+ 8. Nbxd2 d5
9. exd5 Nxd5 10. Qb3 Nce7 11. O-O O-O 12. Rfe1 c6) 3... a6 *
`;
const LONG_LINE =
  "Variation: 3. Bc4 Bc5 4. c3 Nf6 5. d4 exd4 6. cxd4 Bb4+ 7. Bd2 Bxd2+ 8. Nbxd2 d5 9. exd5 Nxd5 10. Qb3 Nce7 11. O-O O-O 12. Rfe1 c6";

test("variations are line rows under the move they replace: browsed, nested, folded when long, and deleted from their row", async ({
  launch,
  profile
}) => {
  const { app, page } = await launch();
  await skipWelcome(page);
  await importPgnFile(app, page, writePgn(profile, "branched.pgn", BRANCHED_PGN));
  const tree = page.getByRole("tree", { name: "Game moves" });
  await expect(tree.getByRole("button", { name: "a6", exact: true })).toBeVisible();

  // A long line starts folded to one row, its end clipped; the chevron shows it whole, and folds it.
  const long = tree.getByRole("group", { name: LONG_LINE });
  await expect(long).toBeVisible();
  const showWhole = long.getByRole("button", { name: "Show the whole line" });
  await expect(showWhole).toHaveAttribute("aria-expanded", "false");
  const lastMove = long.getByRole("button", { name: "c6", exact: true });
  const firstMove = long.getByRole("button", { name: "Bc4", exact: true });
  const foldedHeight = (await box(long)).height;
  expect(await left(lastMove)).toBeGreaterThan((await box(long)).x + (await box(long)).width);
  await showWhole.click();
  const fold = long.getByRole("button", { name: "Fold the line" });
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  expect((await box(long)).height).toBeGreaterThan(foldedHeight);
  // Every move is inside the row now, the last ones wrapped onto later rows.
  const longBox = await box(long);
  const lastBox = await box(lastMove);
  expect(lastBox.x + lastBox.width).toBeLessThanOrEqual(longBox.x + longBox.width);
  expect(lastBox.y).toBeGreaterThan(await top(firstMove));
  await fold.click();
  await expect(showWhole).toHaveAttribute("aria-expanded", "false");

  // Playing off the main line from 2… Nc6 makes a variation row under the pair of 3. Bb5.
  await tree.getByRole("button", { name: "Nc6", exact: true }).click();
  await clickSquare(page, "d2");
  await clickSquare(page, "d4");
  await clickSquare(page, "e5");
  await clickSquare(page, "d4");
  const played = tree.getByRole("group", { name: "Variation: 3. d4 exd4" });
  await expect(played).toBeVisible();
  const exd4 = played.getByRole("button", { name: "exd4", exact: true });
  const d4 = played.getByRole("button", { name: "d4", exact: true });
  await expect(exd4).toHaveAttribute("aria-current", "step");
  expect(await top(played)).toBeGreaterThan(
    await top(tree.getByRole("button", { name: "Bb5", exact: true }))
  );

  // Its moves are the game's: clicking one goes to it, and ← → step along the variation.
  await d4.click();
  await expect(d4).toHaveAttribute("aria-current", "step");
  await expect(d4).not.toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(exd4).toHaveAttribute("aria-current", "step");
  await page.keyboard.press("ArrowLeft");
  await expect(d4).toHaveAttribute("aria-current", "step");

  // Another move after 3. d4 nests under the variation's row, one step in.
  await clickSquare(page, "d7");
  await clickSquare(page, "d6");
  const nested = tree.getByRole("group", { name: "Variation: 3… d6" });
  await expect(nested).toBeVisible();
  await expect(nested.getByRole("button", { name: "d6", exact: true })).toHaveAttribute(
    "aria-current",
    "step"
  );
  expect(await left(nested)).toBeGreaterThan(await left(played));
  expect(await top(nested)).toBeGreaterThan(await top(played));

  // The row's delete icon (shown on hover) deletes the line from its current move (the app asks
  // with window.confirm, answered yes here).
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  await nested.hover();
  await nested.getByRole("button", { name: "Delete line from d6" }).click();
  await expect(nested).toHaveCount(0);
  await expect(played).toBeVisible();
  // With none of its moves current, the row's icons act on its first move: the whole line.
  await tree.getByRole("button", { name: "a6", exact: true }).click();
  await played.hover();
  await played.getByRole("button", { name: "Delete line from d4" }).click();
  await expect(played).toHaveCount(0);
  await expect(variations(tree)).toHaveCount(1);
});

test("on Analyze, a variation's row promotes it to the main line, and the old line becomes its variation", async ({
  launch,
  profile
}) => {
  const { app, page } = await launch();
  await skipWelcome(page);
  await importPgnFile(app, page, writePgn(profile, "ruy-lopez.pgn", RUY_LOPEZ_PGN));
  const tree = page.getByRole("tree", { name: "Game moves" });
  await expect(tree.getByRole("button", { name: "a6", exact: true })).toBeVisible();

  // 3. d4 instead of 3. Bb5: a variation row.
  await tree.getByRole("button", { name: "Nc6", exact: true }).click();
  await clickSquare(page, "d2");
  await clickSquare(page, "d4");
  const played = tree.getByRole("group", { name: "Variation: 3. d4" });
  await expect(played).toBeVisible();

  await played.hover();
  await played.getByRole("button", { name: "Promote the variation with d4" }).click();
  // 3. d4 is on the main line now (still the current move), and 3. Bb5 a6 is the variation.
  await expect(tree.getByRole("group", { name: "Variation: 3. Bb5 a6" })).toBeVisible();
  await expect(variations(tree)).toHaveCount(1);
  const d4 = tree.locator("[data-move-cell]").getByRole("button", { name: "d4", exact: true });
  await expect(d4).toHaveAttribute("aria-current", "step");
  await expect(
    page.getByRole("navigation", { name: "Move navigation" }).getByRole("paragraph").first()
  ).toHaveText("5 / 5");
});
