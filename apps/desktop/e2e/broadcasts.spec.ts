// Broadcasts: a tournament relayed by Lichess, from the hub to a live game on the analysis board
// and back to its live position. Lichess's answers are recorded files (fixtures.ts).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { clickSquare, expect, routeToFile, sidebar, skipWelcome, test } from "./app";
import { writeBroadcastFixtures } from "./fixtures";

/** Where a run saves its screens for a look (unset: none are taken). */
const SCREENS = process.env.CHATURANGA_E2E_SCREENS;

async function screen(page: Page, name: string): Promise<void> {
  if (SCREENS) await page.screenshot({ path: join(SCREENS, `${name}.png`) });
}

test("follows a broadcast game live on the analysis board, and goes back to live", async ({
  launch
}) => {
  const { app, page } = await launch();
  await skipWelcome(page);
  const dir = mkdtempSync(join(tmpdir(), "broadcast-"));
  for (const [url, file] of Object.entries(writeBroadcastFixtures(dir)))
    await routeToFile(app, url, file);

  // The hub: the live event, its top board read from the round.
  await sidebar(page).getByRole("button", { name: "Broadcasts", exact: true }).click();
  const event = page.getByRole("button", { name: /FIDE Grand Swiss 2026/ });
  await expect(event).toBeVisible();
  await expect(event.getByText("Gukesh D")).toBeVisible();
  await screen(page, "1-hub");

  // Search finds a player's game in the live rounds; picking it opens its tournament.
  await page.getByRole("combobox").fill("gukesh");
  const result = page.getByRole("option", { name: /Gukesh D – GM Carlsen/ });
  await expect(result).toBeVisible();
  await screen(page, "2-search");
  await result.click();

  // The tournament: every board of the live round, a finished one with its result.
  const boards = page.getByRole("region", { name: "Boards" });
  await expect(boards.getByRole("button", { name: /^Board \d/ })).toHaveCount(3);
  await expect(boards.getByRole("button", { name: /^Board 3: .*½–½/ })).toBeVisible();
  await screen(page, "3-tournament");

  // The standings, each player with their game in the round.
  await page.getByRole("tab", { name: "Players" }).click();
  const standings = page.getByRole("region", { name: "Standings" });
  await expect(standings.getByRole("row", { name: /Gukesh D.*vs Carlsen, Magnus/ })).toBeVisible();
  await screen(page, "4-players");
  await page.getByRole("tab", { name: /Boards/ }).click();

  // A board opens on the Analyze board at its live position, following the game.
  await boards.getByRole("button", { name: /^Board 1: GM Gukesh D against GM Carlsen/ }).click();
  await expect(sidebar(page).getByRole("button", { name: "Analyze", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  const status = page.getByRole("status").filter({ hasText: "Following live" });
  await expect(status).toBeVisible();
  await screen(page, "5-following");

  // A move of your own: the board leaves the live game, which shows beside the way back.
  await clickSquare(page, "g2");
  await clickSquare(page, "g4");
  const backToLive = page.getByRole("button", { name: /Back to live/ });
  await expect(backToLive).toContainText("clears your 1 move");
  await screen(page, "6-exploring");

  // Back to live clears it; Undo puts it back.
  await backToLive.click();
  await expect(status).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(backToLive).toContainText("clears your 1 move");
  // The L key does the same.
  await page.keyboard.press("l");
  await expect(status).toBeVisible();
});
