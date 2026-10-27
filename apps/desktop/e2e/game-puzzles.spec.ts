// Puzzles from the user's own games through the built app (docs/puzzles-from-games.md): a game
// played by a connected chess.com account, the Databases → My games card, the Generate puzzles
// dialog, the background queue on a scripted engine, and the "From my games" set in Puzzles. The
// network is off in these runs (chess.com answers from fixtures); how to run them:
// playwright.config.ts.
import type { ElectronApplication, Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  clickSquare,
  desktopDir,
  expect,
  importPgnFile,
  registerFakeEngine,
  routeToFile,
  sidebar,
  skipWelcome,
  test
} from "./app";
import { writePgn } from "./fixtures";

const API = "https://api.chess.com/pub/player/ayush_p64";
const FIXTURES = join(desktopDir, "src/main/chesscom/__fixtures__");

/**
 * The user's game (White is the chess.com account): 4. d3?? misses Qxf7#. The fake engine's
 * "puzzles" mode scripts its lines, which make exactly one puzzle: Your mistake, tagged Missed
 * chance (3... Nf6?? handed White the mate).
 */
const MY_GAME_PGN = `[Event "E2E my game"]
[White "ayush_p64"]
[Black "e2e_rival"]
[Result "0-1"]

1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. d3 Nxh5 0-1
`;

/** A 1×1 PNG: the account's picture. */
const AVATAR_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/** Chess.com's answers for the account: its profile, picture and ratings, and no games of its own. */
async function serveChesscom(app: ElectronApplication, profile: string): Promise<void> {
  const archives = join(profile, "chesscom-archives.json");
  writeFileSync(archives, JSON.stringify({ archives: [] }));
  const avatar = join(profile, "chesscom-avatar.png");
  writeFileSync(avatar, AVATAR_PNG);
  const routes: [string, string][] = [
    // profile.json's `avatar`.
    ["https://images.chesscomfiles.com/uploads/v1/user/1.png", avatar],
    [API, join(FIXTURES, "profile.json")],
    [`${API}/stats`, join(FIXTURES, "stats.json")],
    [`${API}/games/archives`, archives]
  ];
  for (const [url, file] of routes) await routeToFile(app, url, file);
}

/** Connects the fixture account from Settings (the account the game's White is). */
async function connectChesscom(page: Page): Promise<void> {
  await sidebar(page).getByRole("button", { name: "Settings", exact: true }).click();
  const card = page.locator("#settings-chesscom");
  await card.getByLabel("Chess.com username").fill("ayush_p64");
  await card.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(card.getByText("Ayush_P64", { exact: true })).toBeVisible({ timeout: 20_000 });
}

const myGamesCard = (page: Page) =>
  page.getByRole("article").filter({ has: page.getByRole("heading", { name: "My games" }) });

/** The card's facts: Games, Processed, Puzzles, Due. */
const cardFacts = (page: Page) => myGamesCard(page).getByRole("definition");

test("finds a puzzle in the user's game and trains it in Puzzles' From my games set", async ({
  launch,
  profile
}) => {
  test.setTimeout(120_000);
  const { app, page } = await launch();
  await skipWelcome(page);
  await registerFakeEngine(page, join(profile, "fake-engine.log"), "puzzles");
  await serveChesscom(app, profile);
  await connectChesscom(page);
  await importPgnFile(app, page, writePgn(profile, "my-game.pgn", MY_GAME_PGN));
  await expect(
    page
      .getByRole("tree", { name: "Game moves" })
      .getByRole("button", { name: "Nxh5", exact: true })
  ).toBeVisible();

  // Databases → My games: one imported game, nothing processed yet, nothing to train.
  await sidebar(page).getByRole("button", { name: "Databases", exact: true }).click();
  const card = myGamesCard(page);
  await expect(card).toContainText("Imported 1");
  await expect(cardFacts(page)).toHaveText(["1", "0", "0", "0"]);
  await expect(card.getByRole("button", { name: "Train", exact: true })).toBeDisabled();

  // Generate puzzles: the game matches; without Maia 3 its two kinds can't be chosen.
  await card.getByRole("button", { name: "Generate puzzles", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Generate puzzles" });
  const start = dialog.getByRole("button", { name: "Start", exact: true });
  await expect(dialog).toContainText("1 game matches");
  for (const kind of ["Your mistakes", "Missed chances", "Opponent's chances"]) {
    const box = dialog.getByRole("checkbox", { name: kind, exact: true });
    await expect(box).toBeChecked();
    await expect(box).toBeEnabled();
  }
  for (const kind of ["Tricky positions", "Hard finds"]) {
    const box = dialog.getByRole("checkbox", { name: kind, exact: true });
    await expect(box).not.toBeChecked();
    await expect(box).toBeDisabled();
  }
  // The count follows the games chosen: without imported games none match, and Start waits.
  const imported = dialog
    .getByRole("group", { name: "Games from" })
    .getByRole("button", { name: "Imported", exact: true });
  await imported.click();
  await expect(dialog).toContainText("0 games match");
  await expect(start).toBeDisabled();
  await imported.click();
  await expect(dialog).toContainText("1 game matches");
  // No kind, no Start either.
  for (const kind of ["Your mistakes", "Missed chances", "Opponent's chances"])
    await dialog.getByRole("checkbox", { name: kind, exact: true }).click();
  await expect(start).toBeDisabled();
  for (const kind of ["Your mistakes", "Missed chances", "Opponent's chances"])
    await dialog.getByRole("checkbox", { name: kind, exact: true }).click();
  await dialog
    .getByRole("radiogroup", { name: "Depth" })
    .getByRole("radio", { name: "Quick", exact: true })
    .click();
  await expect(dialog).toContainText("Scan depth 10 · check depth 16");
  await start.click();
  await expect(dialog).toBeHidden();

  // The queue works through the game in the background (after any engine use of the last 10 s):
  // one game processed, one puzzle found and due.
  await expect(cardFacts(page)).toHaveText(["1", "1", "1", "1"], { timeout: 30_000 });
  await expect(card.getByRole("status")).toHaveCount(0);

  // Train opens Puzzles on the From my games set.
  await card.getByRole("button", { name: "Train", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Puzzles", level: 1 })).toBeVisible();
  await expect(page.getByRole("combobox", { name: /^Database/ })).toHaveValue("my-games");
  await expect(page.getByText("1 due · 1 puzzle", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start puzzles" }).click();

  // The puzzle position after 3... Nf6, White to move; where it comes from stays hidden until it
  // is over (the kind would give the answer away).
  const puzzle = page.getByRole("region", { name: "Puzzle" });
  await expect(puzzle.getByRole("heading", { level: 2 })).toHaveText("White to move");
  await expect(puzzle).toContainText("0 of 1 move found");
  const facts = puzzle.getByRole("group", { name: "From your game" });
  await expect(facts).toHaveCount(0);
  await clickSquare(page, "h5");
  await clickSquare(page, "f7");
  await expect(page.getByRole("button", { name: "Next puzzle", exact: true })).toBeVisible();

  // Solved: its kind and tag, the game it comes from, and Open game.
  await expect(facts).toBeVisible();
  await expect(facts).toContainText("Your mistake");
  await expect(facts).toContainText("Missed chance");
  await expect(facts).toContainText("vs e2e_rival");
  await expect(facts).toContainText("move 4");
  await facts.getByRole("button", { name: "Open game", exact: true }).click();
  // The game opens at the move played from the puzzle position: 4. d3.
  await expect(
    page.getByRole("tree", { name: "Game moves" }).getByRole("button", { name: "d3", exact: true })
  ).toHaveAttribute("aria-current", "step");

  // Solved cleanly, the puzzle comes back later: none is due now.
  await sidebar(page).getByRole("button", { name: "Databases", exact: true }).click();
  await expect(cardFacts(page)).toHaveText(["1", "1", "1", "0"]);
});
