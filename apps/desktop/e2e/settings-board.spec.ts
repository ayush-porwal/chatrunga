// Settings → Board → Piece sizes, through the built app; how to run it: playwright.config.ts.
import type { Page } from "@playwright/test";
import { closeApp, expect, sidebar, skipWelcome, test } from "./app";

const pieceSizes = (page: Page) => page.getByRole("radiogroup", { name: "Piece sizes" });

/** The drawing a white pawn on the Analyze board paints (its CSS background). */
async function pawnDrawing(page: Page): Promise<string> {
  await sidebar(page).getByRole("button", { name: "Analyze", exact: true }).click();
  const pawn = page
    .getByRole("region", { name: "Board" })
    .locator("cg-board piece.white.pawn")
    .first();
  await expect(pawn).toBeVisible();
  return pawn.evaluate((element) => getComputedStyle(element).backgroundImage);
}

async function openSettings(page: Page): Promise<void> {
  await sidebar(page).getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
}

test("Uniform piece sizes redraw the board's pieces and are kept across a restart", async ({
  launch,
  profile
}) => {
  const first = await launch();
  await skipWelcome(first.page);
  // The set's own drawings have loaded once the pawn paints one of them, not Chessground's sprite.
  await expect.poll(() => pawnDrawing(first.page)).toContain("viewBox");
  const ranked = await pawnDrawing(first.page);

  await openSettings(first.page);
  await expect(pieceSizes(first.page).getByRole("radio", { name: "Ladder" })).toBeChecked();
  await pieceSizes(first.page).getByRole("radio", { name: "Uniform" }).click();
  await expect(pieceSizes(first.page).getByRole("radio", { name: "Uniform" })).toBeChecked();
  const uniform = await pawnDrawing(first.page);
  expect(uniform).not.toBe(ranked);
  await closeApp(first.app);

  const second = await launch(profile);
  await expect(sidebar(second.page)).toBeVisible();
  await expect.poll(() => pawnDrawing(second.page)).toBe(uniform);
  await openSettings(second.page);
  await expect(pieceSizes(second.page).getByRole("radio", { name: "Uniform" })).toBeChecked();
});
