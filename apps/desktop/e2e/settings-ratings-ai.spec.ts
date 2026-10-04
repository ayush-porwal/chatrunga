// Settings → Ratings (one rating per Lichess mode) and Settings → AI (the one OpenRouter model and
// key every AI feature uses), through the built app; how to run them: playwright.config.ts.
import type { Page } from "@playwright/test";
import type { PlayerRatings } from "../../../packages/shared/src/types/ratings";
import { closeApp, expect, importPgnFile, sidebar, skipWelcome, test } from "./app";
import { RUY_LOPEZ_PGN, writePgn } from "./fixtures";

const MODES = ["Bullet", "Blitz", "Rapid", "Classical", "Correspondence"] as const;

const ratingsGroup = (page: Page) => page.getByRole("region", { name: "Ratings", exact: true });
const ratingField = (page: Page, mode: (typeof MODES)[number]) =>
  ratingsGroup(page).getByRole("spinbutton", { name: mode, exact: true });
/** A synced mode's cell: its name and the number, as plain text. */
const ratingCell = (page: Page, mode: (typeof MODES)[number]) =>
  ratingsGroup(page).getByRole("group", { name: mode, exact: true });
const reviewTabs = (page: Page) => page.getByRole("tablist", { name: "Game review sections" });

/**
 * Stores ratings as the main process's Lichess sync would (set-up, not the journey). Sent as
 * source: the page's CSP forbids building functions from strings there.
 */
async function seedRatings(page: Page, ratings: PlayerRatings): Promise<void> {
  await page.evaluate(
    `window.chaturanga.settings.set("playerRatings", ${JSON.stringify(ratings)})`
  );
}

async function openSettings(page: Page): Promise<void> {
  await sidebar(page).getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
}

test("Settings has a rating per Lichess mode; one typed in is kept across a restart", async ({
  launch,
  profile
}) => {
  const first = await launch();
  await skipWelcome(first.page);
  await openSettings(first.page);
  for (const mode of MODES) {
    await expect(ratingField(first.page, mode)).toHaveValue("1500");
    await expect(ratingField(first.page, mode)).toBeEditable();
  }

  await ratingField(first.page, "Blitz").fill("1720");
  await ratingField(first.page, "Blitz").press("Enter");
  await expect(ratingField(first.page, "Blitz")).toHaveValue("1720");
  // Only that mode changed.
  await expect(ratingField(first.page, "Rapid")).toHaveValue("1500");
  // Out of range is held to the range.
  await ratingField(first.page, "Bullet").fill("9000");
  await ratingField(first.page, "Bullet").blur();
  await expect(ratingField(first.page, "Bullet")).toHaveValue("3500");
  await closeApp(first.app);

  const second = await launch(profile);
  await expect(sidebar(second.page)).toBeVisible();
  await openSettings(second.page);
  await expect(ratingField(second.page, "Blitz")).toHaveValue("1720");
  await expect(ratingField(second.page, "Bullet")).toHaveValue("3500");
  await expect(ratingField(second.page, "Classical")).toHaveValue("1500");
});

test("ratings synced from Lichess are plain read-only text; disconnected, they're inputs again", async ({
  launch
}) => {
  const { page } = await launch();
  await skipWelcome(page);
  // What a sync stores (the network is off in these runs, so no account can connect).
  const syncedAt = Date.now() - 2 * 60 * 60 * 1000;
  await seedRatings(page, {
    bullet: { source: "lichess", rating: 1650, syncedAt },
    blitz: { source: "lichess", rating: 1720, syncedAt },
    rapid: { source: "lichess", rating: 1810, syncedAt },
    classical: { source: "lichess", rating: 1500, syncedAt },
    correspondence: { source: "lichess", rating: 1500, syncedAt }
  });
  await openSettings(page);

  await expect(ratingsGroup(page).getByRole("spinbutton")).toHaveCount(0);
  await expect(ratingCell(page, "Blitz")).toHaveText(/1720/);
  await expect(ratingCell(page, "Rapid")).toHaveText(/1810/);
  // No per-mode status: the group's one line explains where the numbers come from.
  await expect(ratingsGroup(page)).not.toContainText(/updated|provisional/i);
  await expect(ratingsGroup(page)).toContainText("With Lichess connected, they come from");

  // Disconnecting keeps the last synced values, as typed-in ones (what the sync's release stores).
  await seedRatings(page, {
    bullet: { source: "manual", rating: 1650 },
    blitz: { source: "manual", rating: 1720 },
    rapid: { source: "manual", rating: 1810 },
    classical: { source: "manual", rating: 1500 },
    correspondence: { source: "manual", rating: 1500 }
  });
  // Settings reads them again when opened.
  await sidebar(page).getByRole("button", { name: "Home", exact: true }).click();
  await openSettings(page);
  await expect(ratingField(page, "Blitz")).toHaveValue("1720");
  await expect(ratingField(page, "Blitz")).toBeEditable();
  await ratingField(page, "Rapid").fill("1650");
  await ratingField(page, "Rapid").press("Enter");
  await expect(ratingField(page, "Rapid")).toHaveValue("1650");
});

test("the AI section holds the one model and key; Review settings link to it and to the ratings", async ({
  launch,
  profile
}) => {
  const { app, page } = await launch();
  await skipWelcome(page);
  await openSettings(page);
  const ai = page.locator("#settings-ai");
  await expect(ai.getByRole("heading", { name: "AI", exact: true })).toBeVisible();
  await expect(ai.getByLabel("OpenRouter model")).toBeVisible();
  await expect(ai.getByLabel("OpenRouter API key")).toBeVisible();
  await expect(ai).toContainText("No key saved. AI features need one.");

  // Review settings no longer hold the key: they name the rating used and link to app Settings.
  await importPgnFile(app, page, writePgn(profile, "ruy-lopez.pgn", RUY_LOPEZ_PGN));
  await expect(page.getByRole("region", { name: "Board" })).toBeVisible();
  await sidebar(page).getByRole("button", { name: "Game review", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Choose a game" })
    .getByRole("button", { name: /^Alpha vs Beta/ })
    .click();
  // Review settings are a dialog behind the gear in the panel's Review header, not a tab.
  await expect(reviewTabs(page).getByRole("tab", { name: "Settings", exact: true })).toHaveCount(0);
  await page
    .getByRole("complementary", { name: "Review" })
    .getByRole("button", { name: "Review settings", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "Review settings" })).toBeVisible();
  await expect(page.getByLabel("OpenRouter API key")).toHaveCount(0);
  // The game has no ratings or time control: the Settings rating for rapid.
  await expect(page.getByText("Rapid 1500 · from Settings")).toBeVisible();

  await page.getByRole("button", { name: "AI settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await expect(ai.getByRole("heading", { name: "AI", exact: true })).toBeInViewport();

  // Back to the review (the game is still loaded), then to the ratings.
  await sidebar(page).getByRole("button", { name: "Game review", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Choose a game" });
  await expect(reviewTabs(page).or(picker)).toBeVisible();
  if (await picker.isVisible())
    await picker.getByRole("button", { name: /^Alpha vs Beta/ }).click();
  await page
    .getByRole("complementary", { name: "Review" })
    .getByRole("button", { name: "Review settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit ratings", exact: true }).click();
  await expect(ratingsGroup(page)).toBeInViewport();
});
