// Settings → Your picture, through the built app: a photo chosen in the file dialog is cropped,
// copied into the app's data (with its original, for Adjust) and shows wherever "You" plays (the
// Play card's You tile, your side's player row on the board), and Remove brings the side's colour
// back. How to run it: playwright.config.ts.
import type { Locator, Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, importPgnFile, sidebar, skipWelcome, stubOpenFile, test } from "./app";
import { writePgn } from "./fixtures";

/** A 1×1 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/** A game you played White in (Play writes "You" for your side). */
const YOUR_GAME_PGN = `[Event "E2E your picture"]
[White "You"]
[Black "Beta"]
[Result "*"]

1. e4 e5 *
`;

const pictureCard = (page: Page) => page.locator("#settings-picture");
const playCard = (page: Page) => page.getByRole("region", { name: "Play", exact: true });
/** Your picture: an app copy (the image protocol), loaded. */
const yourPicture = (scope: Page | Locator) => scope.locator('img[src^="chaturanga-image:"]');
/** The innermost shown block holding exactly `name`: that player's row on the board. */
const playerRow = (page: Page, name: string) =>
  page
    .locator("div")
    .filter({ visible: true })
    .filter({ has: page.getByText(name, { exact: true }).filter({ visible: true }) })
    .last();

async function expectLoaded(picture: Locator): Promise<void> {
  await expect(picture).toBeVisible();
  await expect
    .poll(() => picture.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
}

async function openSettings(page: Page): Promise<void> {
  await sidebar(page).getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
}

test("a picture chosen in Settings shows on the Play card and on your side of the board", async ({
  launch,
  profile
}) => {
  const { app, page } = await launch();
  await skipWelcome(page);
  const photo = join(profile, "me.png");
  writeFileSync(photo, PNG);

  await openSettings(page);
  const card = pictureCard(page);
  await expect(card).toContainText("None: your colour shows");
  await expect(yourPicture(card)).toHaveCount(0);
  await stubOpenFile(app, photo);
  await card.getByRole("button", { name: "Choose picture…" }).click();
  // The crop step: the picture under the avatar's frame, positioned by keys, zoomed, then saved.
  const crop = page.getByRole("dialog", { name: "Crop your picture" });
  const area = crop.getByRole("application", { name: /^Picture position/ });
  await expectLoaded(area.locator("img"));
  await crop.getByRole("slider", { name: "Zoom" }).fill("2");
  await area.press("ArrowRight");
  await crop.getByRole("button", { name: "Save", exact: true }).click();
  await expect(crop).toHaveCount(0);
  await expect(card).toContainText("Your photo");
  await expectLoaded(yourPicture(card));

  // Adjust crops it again from the original kept beside it; Cancel leaves it as it was.
  const saved = await yourPicture(card).getAttribute("src");
  await card.getByRole("button", { name: "Adjust", exact: true }).click();
  await expect(crop.getByRole("slider", { name: "Zoom" })).toHaveValue("2");
  await crop.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(crop).toHaveCount(0);
  await expect(yourPicture(card)).toHaveAttribute("src", saved ?? "");

  // The Play card's You tile.
  await sidebar(page).getByRole("button", { name: "Play", exact: true }).click();
  await expectLoaded(yourPicture(playCard(page)));

  // A game you played: your side's player row, and no other place on the board.
  await importPgnFile(app, page, writePgn(profile, "your-game.pgn", YOUR_GAME_PGN));
  const moves = page.getByRole("tree", { name: "Game moves" });
  await expect(moves.getByRole("button", { name: "e5", exact: true })).toBeVisible();
  await expectLoaded(yourPicture(playerRow(page, "You")));
  await expect(yourPicture(playerRow(page, "Beta"))).toHaveCount(0);
  await expect(page.locator('img[src^="chaturanga-image:"]:visible')).toHaveCount(1);

  // Remove: the colour again, in Settings and back on the board.
  await openSettings(page);
  await pictureCard(page).getByRole("button", { name: "Remove", exact: true }).click();
  await expect(pictureCard(page)).toContainText("None: your colour shows");
  await expect(yourPicture(pictureCard(page))).toHaveCount(0);
  await sidebar(page).getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(moves.getByRole("button", { name: "e5", exact: true })).toBeVisible();
  await expect(playerRow(page, "You")).toBeVisible();
  await expect(yourPicture(playerRow(page, "You"))).toHaveCount(0);
  await expect(page.locator('img[src^="chaturanga-image:"]:visible')).toHaveCount(0);
});
