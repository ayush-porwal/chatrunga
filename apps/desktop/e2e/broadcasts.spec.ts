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
  await page.getByRole("combobox", { name: "Search broadcasts" }).fill("gukesh");
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

test("follows a player, rings a board, switches games and keeps a copy", async ({ launch }) => {
  const { app, page } = await launch();
  await skipWelcome(page);
  const dir = mkdtempSync(join(tmpdir(), "broadcast-"));
  for (const [url, file] of Object.entries(writeBroadcastFixtures(dir)))
    await routeToFile(app, url, file);

  // The hub's filter hides what it doesn't keep, and comes back.
  await sidebar(page).getByRole("button", { name: "Broadcasts", exact: true }).click();
  const event = page.getByRole("button", { name: /FIDE Grand Swiss 2026/ });
  await expect(event).toBeVisible();
  const speed = page.getByRole("combobox", { name: "Speed" });
  await speed.selectOption("blitz");
  await expect(page.getByText("No live events match the filter")).toBeVisible();
  await speed.selectOption("all");
  await event.click();

  // A star on the standings follows a player; the crosstable has their game of the round.
  await page.getByRole("tab", { name: "Players" }).click();
  await page.getByRole("button", { name: "Follow Gukesh D" }).click();
  await expect(page.getByRole("button", { name: "Unfollow Gukesh D" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await page.getByRole("radio", { name: "Crosstable" }).click();
  await expect(
    page.getByRole("button", { name: /^Round 7: against Carlsen, Magnus/ })
  ).toBeVisible();
  await screen(page, "7-crosstable");

  // The hub lists the followed player's game.
  await sidebar(page).getByRole("button", { name: "Broadcasts", exact: true }).click();
  const yours = page.getByRole("region", { name: "Your players" });
  await expect(yours.getByRole("button", { name: /Gukesh D – GM Carlsen, Magnus/ })).toBeVisible();
  await screen(page, "8-your-players");
  await yours.getByRole("button", { name: /Gukesh D/ }).click();

  // A live board's bell asks to hear when it ends; the arrow keys move between boards.
  const boards = page.getByRole("region", { name: "Boards" });
  const bell = boards.getByRole("button", { name: "Notify me when board 1 ends" });
  await bell.click();
  await expect(
    boards.getByRole("button", { name: "Don't notify me when board 1 ends" })
  ).toHaveAttribute("aria-pressed", "true");
  const first = boards.getByRole("button", { name: /^Board 1:/ });
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await expect(boards.getByRole("button", { name: /^Board 2:/ })).toBeFocused();

  // On the board: the switcher opens another game of the round, followed in its turn.
  await first.click();
  await expect(page.getByRole("status").filter({ hasText: "Following live" })).toBeVisible();
  await page
    .getByRole("combobox", { name: "Switch to another game of the round" })
    .selectOption("Game0002");
  await expect(page.getByRole("status").filter({ hasText: "Following live" })).toBeVisible();
  await expect(page.getByText("Nakamura, Hikaru").first()).toBeVisible();

  // A copy for the library; the board goes on following.
  await page.getByRole("button", { name: "Save a copy to the library" }).click();
  await expect(page.getByText("Saved a copy to your library.")).toBeVisible();
  await screen(page, "9-switched");
});
